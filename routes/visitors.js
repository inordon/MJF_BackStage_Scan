// routes/visitors.js - исправленная версия с рабочим endpoint для активных событий
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator');
const { query, transaction } = require('../config/database');
const { requireAuth, requireRole, canModifyVisitor } = require('../middleware/auth');

const router = express.Router();

// Убеждаемся, что директории существуют
const ensureDirectoryExists = (dirPath) => {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
};

// Настройка загрузки файлов
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadPath = process.env.UPLOAD_PATH ? path.join(process.env.UPLOAD_PATH, 'photos') : 'uploads/photos';
        ensureDirectoryExists(uploadPath);
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'visitor-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);

        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Разрешены только изображения (JPEG, JPG, PNG, GIF)'));
        }
    }
});

// Функция генерации штрихкода
function generateBarcode() {
    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD
    const randomNum = Math.floor(Math.random() * 9000) + 1000; // 4-значное число
    return `VIS${dateStr}${randomNum}`;
}

// Валидация данных посетителя с штрихкодом
const visitorValidation = [
    body('lastName')
        .trim()
        .isLength({ min: 2, max: 50 })
        .withMessage('Фамилия должна содержать от 2 до 50 символов')
        .matches(/^[а-яёА-ЯЁa-zA-Z\s-]+$/)
        .withMessage('Фамилия может содержать только буквы, пробелы и дефисы'),
    body('firstName')
        .trim()
        .isLength({ min: 2, max: 50 })
        .withMessage('Имя должно содержать от 2 до 50 символов')
        .matches(/^[а-яёА-ЯЁa-zA-Z\s-]+$/)
        .withMessage('Имя может содержать только буквы, пробелы и дефисы'),
    body('middleName')
        .optional()
        .trim()
        .isLength({ max: 50 })
        .withMessage('Отчество не должно превышать 50 символов')
        .matches(/^[а-яёА-ЯЁa-zA-Z\s-]*$/)
        .withMessage('Отчество может содержать только буквы, пробелы и дефисы'),
    body('comment')
        .optional()
        .trim()
        .isLength({ max: 500 })
        .withMessage('Комментарий не должен превышать 500 символов'),
    body('eventId')
        .isInt({ min: 1 })
        .withMessage('Необходимо выбрать событие'),
    body('barcode')
        .optional()
        .trim()
        .isLength({ min: 3, max: 100 })
        .withMessage('Штрихкод должен содержать от 3 до 100 символов')
        .matches(/^[A-Z0-9-_]+$/)
        .withMessage('Штрихкод может содержать только заглавные буквы, цифры, дефисы и подчеркивания')
];

// ИСПРАВЛЕНО: Получить список активных событий для выбора
router.get('/events/active', requireAuth, async (req, res) => {
    try {
        console.log('🎯 Запрос активных событий через /api/visitors/events/active');

        const result = await query(`
            SELECT id, name, description, start_date, end_date, location, status
            FROM events
            WHERE status = 'active' AND end_date >= CURRENT_DATE
            ORDER BY start_date ASC
        `);

        console.log(`📊 Найдено активных событий: ${result.rows.length}`);

        const events = result.rows.map(event => ({
            id: event.id,
            name: event.name,
            description: event.description,
            start_date: event.start_date,
            end_date: event.end_date,
            location: event.location,
            status: event.status
        }));

        res.json({
            success: true,
            events: events,
            count: events.length,
            message: 'Активные события получены успешно'
        });

    } catch (err) {
        console.error('❌ Ошибка получения активных событий:', err);
        res.status(500).json({
            success: false,
            error: 'Ошибка сервера при получении активных событий',
            details: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
});

// Получить всех посетителей с информацией о событиях и штрихкодах
router.get('/', requireAuth, async (req, res) => {
    try {
        // Исправляем параметры с безопасными значениями по умолчанию
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.max(1, Math.min(100, parseInt(req.query.limit) || 25));
        const offset = (page - 1) * limit;

        // Безопасно обрабатываем остальные параметры
        const status = req.query.status && ['active', 'blocked'].includes(req.query.status) ? req.query.status : null;
        const search = req.query.search ? req.query.search.trim() : null;
        const event_id = req.query.event_id && !isNaN(parseInt(req.query.event_id)) ? parseInt(req.query.event_id) : null;

        console.log('Параметры запроса посетителей:', { page, limit, offset, status, search, event_id });

        let queryText = `
            SELECT v.id, v.visitor_uuid, v.last_name, v.first_name, v.middle_name,
                   v.comment, v.status, v.created_at, v.updated_at, v.barcode,
                   v.photo_path, v.qr_code_path, v.event_id,
                   creator.full_name as created_by_name,
                   e.name as event_name, e.start_date as event_start_date, e.end_date as event_end_date,
                   COUNT(s.id) as total_scans,
                   COUNT(CASE WHEN s.scan_date = CURRENT_DATE THEN 1 END) as first_scan_today,
                   MAX(s.scanned_at) as last_scan
            FROM visitors v
                     LEFT JOIN users creator ON v.created_by = creator.id
                     LEFT JOIN events e ON v.event_id = e.id
                     LEFT JOIN scans s ON v.id = s.visitor_id
        `;

        const queryParams = [];
        const conditions = [];

        if (status) {
            conditions.push(`v.status = $${queryParams.length + 1}`);
            queryParams.push(status);
        }

        if (event_id) {
            conditions.push(`v.event_id = $${queryParams.length + 1}`);
            queryParams.push(event_id);
        }

        if (search && search.length > 0) {
            conditions.push(`(
                v.last_name ILIKE $${queryParams.length + 1} OR 
                v.first_name ILIKE $${queryParams.length + 1} OR 
                v.middle_name ILIKE $${queryParams.length + 1} OR
                v.comment ILIKE $${queryParams.length + 1} OR
                v.barcode ILIKE $${queryParams.length + 1} OR
                e.name ILIKE $${queryParams.length + 1}
            )`);
            queryParams.push(`%${search}%`);
        }

        if (conditions.length > 0) {
            queryText += ' WHERE ' + conditions.join(' AND ');
        }

        queryText += `
            GROUP BY v.id, creator.full_name, e.name, e.start_date, e.end_date
            ORDER BY v.created_at DESC
            LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}
        `;

        queryParams.push(limit, offset);

        console.log('SQL запрос:', queryText);
        console.log('Параметры:', queryParams);

        const result = await query(queryText, queryParams);

        // Получаем общее количество записей
        let countQuery = 'SELECT COUNT(*) as total FROM visitors v LEFT JOIN events e ON v.event_id = e.id';
        const countParams = [];

        if (conditions.length > 0) {
            countQuery += ' WHERE ' + conditions.join(' AND ');
            countParams.push(...queryParams.slice(0, -2)); // Убираем limit и offset
        }

        const countResult = await query(countQuery, countParams);
        const total = parseInt(countResult.rows[0].total);

        console.log(`Найдено посетителей: ${result.rows.length}, всего: ${total}`);

        res.json({
            visitors: result.rows.map(visitor => ({
                id: visitor.id,
                visitor_uuid: visitor.visitor_uuid,
                last_name: visitor.last_name,
                first_name: visitor.first_name,
                middle_name: visitor.middle_name,
                comment: visitor.comment,
                status: visitor.status,
                barcode: visitor.barcode,
                created_at: visitor.created_at,
                updated_at: visitor.updated_at,
                photo_path: visitor.photo_path,
                qr_code_path: visitor.qr_code_path,
                event: visitor.event_id ? {
                    id: visitor.event_id,
                    name: visitor.event_name,
                    start_date: visitor.event_start_date,
                    end_date: visitor.event_end_date
                } : null,
                created_by_name: visitor.created_by_name,
                total_scans: parseInt(visitor.total_scans || 0),
                first_scan_today: parseInt(visitor.first_scan_today || 0) > 0,
                last_scan: visitor.last_scan
            })),
            pagination: {
                page: page,
                limit: limit,
                total: total,
                pages: Math.ceil(total / limit)
            }
        });

    } catch (err) {
        console.error('Ошибка получения посетителей:', err);
        console.error('Стек ошибки:', err.stack);

        res.status(500).json({
            error: 'Ошибка сервера при получении посетителей',
            details: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
});

// Создать нового посетителя с штрихкодом
router.post('/', requireAuth, upload.single('photo'), visitorValidation, async (req, res) => {
    try {
        console.log('Создание посетителя, тело запроса:', req.body);
        console.log('Загруженный файл:', req.file);

        // Проверка валидации
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            console.log('Ошибки валидации:', errors.array());
            return res.status(400).json({
                error: 'Ошибки валидации',
                details: errors.array()
            });
        }

        const { lastName, firstName, middleName, comment, eventId } = req.body;
        let { barcode } = req.body;

        const photo_path = req.file ? req.file.path : null;
        const visitor_uuid = uuidv4();

        // Если штрихкод не указан, генерируем автоматически
        if (!barcode || barcode.trim() === '') {
            barcode = generateBarcode();
        } else {
            barcode = barcode.trim().toUpperCase();
        }

        console.log('Данные для создания посетителя:', {
            lastName, firstName, middleName, comment, eventId, barcode, photo_path, visitor_uuid
        });

        // Проверяем существование события
        const eventCheck = await query('SELECT id, name, status FROM events WHERE id = $1', [eventId]);
        if (!eventCheck.rows.length) {
            return res.status(400).json({ error: 'Выбранное событие не найдено' });
        }

        if (eventCheck.rows[0].status !== 'active') {
            return res.status(400).json({ error: 'Нельзя добавлять посетителей в неактивное событие' });
        }

        // Проверяем уникальность штрихкода
        const barcodeCheck = await query('SELECT id FROM visitors WHERE barcode = $1', [barcode]);
        if (barcodeCheck.rows.length > 0) {
            return res.status(400).json({ error: 'Посетитель с таким штрихкодом уже существует' });
        }

        const result = await transaction(async (client) => {
            // Создаем посетителя
            console.log('Создание записи посетителя в БД...');
            const visitorResult = await client.query(`
                INSERT INTO visitors (
                    visitor_uuid, last_name, first_name, middle_name,
                    comment, photo_path, status, event_id, barcode, created_by
                ) VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, $8, $9)
                    RETURNING id
            `, [
                visitor_uuid, lastName, firstName,
                middleName, comment, photo_path, eventId, barcode, req.user.id
            ]);

            const visitorId = visitorResult.rows[0].id;
            console.log('Посетитель создан с ID:', visitorId);

            // Генерируем QR код из штрихкода
            console.log('Генерация QR кода из штрихкода:', barcode);
            const qrData = barcode; // QR код содержит штрихкод

            const qrCodeDir = process.env.UPLOAD_PATH ? path.join(process.env.UPLOAD_PATH, 'qr-codes') : 'uploads/qr-codes';
            ensureDirectoryExists(qrCodeDir);
            const qrCodePath = path.join(qrCodeDir, `visitor-${barcode}-qr.png`);

            try {
                await QRCode.toFile(qrCodePath, qrData, {
                    errorCorrectionLevel: 'M',
                    type: 'png',
                    quality: 0.92,
                    margin: 1,
                    color: {
                        dark: '#000000',
                        light: '#FFFFFF'
                    },
                    width: 256
                });
                console.log('QR код сохранен:', qrCodePath);
            } catch (qrError) {
                console.error('Ошибка генерации QR кода:', qrError);
                throw new Error('Не удалось создать QR код: ' + qrError.message);
            }

            // Обновляем путь к QR коду
            await client.query(
                'UPDATE visitors SET qr_code_path = $1 WHERE id = $2',
                [qrCodePath, visitorId]
            );

            console.log('QR код привязан к посетителю');
            return visitorId;
        });

        // Получаем созданного посетителя с информацией о событии
        const createdVisitor = await query(`
            SELECT v.*, e.name as event_name
            FROM visitors v
                     LEFT JOIN events e ON v.event_id = e.id
            WHERE v.id = $1
        `, [result]);

        console.log('Посетитель успешно создан');

        res.status(201).json({
            message: 'Посетитель успешно создан',
            visitor: {
                id: createdVisitor.rows[0].id,
                visitor_uuid: createdVisitor.rows[0].visitor_uuid,
                last_name: createdVisitor.rows[0].last_name,
                first_name: createdVisitor.rows[0].first_name,
                middle_name: createdVisitor.rows[0].middle_name,
                comment: createdVisitor.rows[0].comment,
                status: createdVisitor.rows[0].status,
                barcode: createdVisitor.rows[0].barcode,
                photo_path: createdVisitor.rows[0].photo_path,
                qr_code_path: createdVisitor.rows[0].qr_code_path,
                event_id: createdVisitor.rows[0].event_id,
                event_name: createdVisitor.rows[0].event_name,
                created_at: createdVisitor.rows[0].created_at
            }
        });

    } catch (err) {
        console.error('Ошибка создания посетителя:', err);

        // Более детальная информация об ошибке
        let errorMessage = 'Ошибка сервера при создании посетителя';
        if (err.message.includes('QR код')) {
            errorMessage = err.message;
        } else if (err.constraint && err.constraint.includes('barcode')) {
            errorMessage = 'Посетитель с таким штрихкодом уже существует';
        } else if (err.constraint) {
            errorMessage = 'Ошибка ограничений базы данных';
        }

        res.status(500).json({
            error: errorMessage,
            details: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
});

// Получить посетителя по штрихкоду
router.get('/barcode/:barcode', requireAuth, async (req, res) => {
    try {
        const { barcode } = req.params;

        const result = await query(`
            SELECT v.*,
                   creator.full_name as created_by_name,
                   updater.full_name as updated_by_name,
                   e.name as event_name, e.start_date as event_start_date, e.end_date as event_end_date
            FROM visitors v
                     LEFT JOIN users creator ON v.created_by = creator.id
                     LEFT JOIN users updater ON v.updated_by = updater.id
                     LEFT JOIN events e ON v.event_id = e.id
            WHERE v.barcode = $1
        `, [barcode]);

        if (!result.rows.length) {
            return res.status(404).json({ error: 'Посетитель с таким штрихкодом не найден' });
        }

        const visitor = result.rows[0];

        res.json({
            id: visitor.id,
            visitor_uuid: visitor.visitor_uuid,
            last_name: visitor.last_name,
            first_name: visitor.first_name,
            middle_name: visitor.middle_name,
            comment: visitor.comment,
            status: visitor.status,
            barcode: visitor.barcode,
            created_at: visitor.created_at,
            updated_at: visitor.updated_at,
            photo_path: visitor.photo_path,
            qr_code_path: visitor.qr_code_path,
            event: visitor.event_id ? {
                id: visitor.event_id,
                name: visitor.event_name,
                start_date: visitor.event_start_date,
                end_date: visitor.event_end_date
            } : null,
            created_by_name: visitor.created_by_name,
            updated_by_name: visitor.updated_by_name
        });

    } catch (err) {
        console.error('Ошибка получения посетителя по штрихкоду:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Статистика посетителей с разбивкой по событиям
router.get('/stats/overview', requireAuth, async (req, res) => {
    try {
        const visitorsStats = await query(`
            SELECT
                COUNT(*) as total_visitors,
                COUNT(CASE WHEN status = 'active' THEN 1 END) as active_visitors,
                COUNT(CASE WHEN status = 'blocked' THEN 1 END) as blocked_visitors,
                COUNT(CASE WHEN created_at::date = CURRENT_DATE THEN 1 END) as today_created
            FROM visitors
        `);

        const scansStats = await query(`
            SELECT
                COUNT(*) as total_scans,
                COUNT(CASE WHEN scan_date = CURRENT_DATE THEN 1 END) as today_scans,
                COUNT(CASE WHEN scan_date >= CURRENT_DATE - INTERVAL '7 days' THEN 1 END) as week_scans,
                COUNT(DISTINCT visitor_id) as unique_visitors_scanned
            FROM scans
        `);

        const eventStats = await query(`
            SELECT
                e.id, e.name,
                COUNT(v.id) as visitors_count,
                COUNT(s.id) as scans_count,
                COUNT(CASE WHEN s.scan_date = CURRENT_DATE THEN 1 END) as today_scans
            FROM events e
                     LEFT JOIN visitors v ON e.id = v.event_id
                     LEFT JOIN scans s ON v.id = s.visitor_id
            WHERE e.status = 'active'
            GROUP BY e.id, e.name
            ORDER BY visitors_count DESC
                LIMIT 5
        `);

        const recentActivity = await query(`
            SELECT s.*, v.last_name, v.first_name, v.middle_name,
                   e.name as event_name, u.full_name as scanned_by_name
            FROM scans s
                     JOIN visitors v ON s.visitor_id = v.id
                     LEFT JOIN events e ON v.event_id = e.id
                     LEFT JOIN users u ON s.scanned_by = u.id
            WHERE s.scan_date >= CURRENT_DATE - INTERVAL '7 days'
            ORDER BY s.scanned_at DESC
                LIMIT 10
        `);

        res.json({
            visitors: visitorsStats.rows[0],
            scans: scansStats.rows[0],
            eventStats: eventStats.rows.map(event => ({
                id: event.id,
                name: event.name,
                visitors_count: parseInt(event.visitors_count || 0),
                scans_count: parseInt(event.scans_count || 0),
                today_scans: parseInt(event.today_scans || 0)
            })),
            recentActivity: recentActivity.rows.map(scan => ({
                ...scan,
                event_name: scan.event_name
            })),
            timestamp: new Date()
        });

    } catch (err) {
        console.error('Ошибка получения статистики:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Получить посетителя по ID
router.get('/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;

        const result = await query(`
            SELECT v.*,
                   creator.full_name as created_by_name,
                   updater.full_name as updated_by_name,
                   e.name as event_name, e.start_date as event_start_date, e.end_date as event_end_date
            FROM visitors v
                     LEFT JOIN users creator ON v.created_by = creator.id
                     LEFT JOIN users updater ON v.updated_by = updater.id
                     LEFT JOIN events e ON v.event_id = e.id
            WHERE v.id = $1
        `, [id]);

        if (!result.rows.length) {
            return res.status(404).json({ error: 'Посетитель не найден' });
        }

        const visitor = result.rows[0];

        res.json({
            id: visitor.id,
            visitor_uuid: visitor.visitor_uuid,
            last_name: visitor.last_name,
            first_name: visitor.first_name,
            middle_name: visitor.middle_name,
            comment: visitor.comment,
            status: visitor.status,
            barcode: visitor.barcode,
            created_at: visitor.created_at,
            updated_at: visitor.updated_at,
            photo_path: visitor.photo_path,
            qr_code_path: visitor.qr_code_path,
            event: visitor.event_id ? {
                id: visitor.event_id,
                name: visitor.event_name,
                start_date: visitor.event_start_date,
                end_date: visitor.event_end_date
            } : null,
            created_by_name: visitor.created_by_name,
            updated_by_name: visitor.updated_by_name
        });

    } catch (err) {
        console.error('Ошибка получения посетителя:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Получить QR код посетителя (теперь генерируется из штрихкода)
router.get('/:id/qr', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;

        const result = await query(
            'SELECT qr_code_path, barcode, last_name, first_name, middle_name FROM visitors WHERE id = $1',
            [id]
        );

        if (!result.rows.length) {
            return res.status(404).json({ error: 'Посетитель не найден' });
        }

        const visitor = result.rows[0];

        if (visitor.qr_code_path && fs.existsSync(visitor.qr_code_path)) {
            res.sendFile(path.resolve(visitor.qr_code_path));
        } else {
            // Генерируем QR код на лету из штрихкода
            const qrData = visitor.barcode;

            res.setHeader('Content-Type', 'image/png');
            const qrStream = await QRCode.toBuffer(qrData, {
                errorCorrectionLevel: 'M',
                type: 'png',
                quality: 0.92,
                margin: 1,
                color: {
                    dark: '#000000',
                    light: '#FFFFFF'
                },
                width: 256
            });

            res.send(qrStream);
        }

    } catch (err) {
        console.error('Ошибка получения QR кода:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Заблокировать/разблокировать посетителя
router.patch('/:id/status', requireAuth, requireRole(['admin', 'moderator']), async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        if (!['active', 'blocked'].includes(status)) {
            return res.status(400).json({ error: 'Некорректный статус' });
        }

        const result = await query(`
            UPDATE visitors SET
                                status = $1,
                                updated_at = CURRENT_TIMESTAMP,
                                updated_by = $2
            WHERE id = $3
                RETURNING *
        `, [status, req.user.id, id]);

        if (!result.rows.length) {
            return res.status(404).json({ error: 'Посетитель не найден' });
        }

        res.json({
            message: `Посетитель ${status === 'blocked' ? 'заблокирован' : 'разблокирован'}`,
            visitor: {
                id: result.rows[0].id,
                status: result.rows[0].status,
                updated_at: result.rows[0].updated_at
            }
        });

    } catch (err) {
        console.error('Ошибка изменения статуса посетителя:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Удалить посетителя (только для администраторов)
router.delete('/:id', requireAuth, requireRole(['admin']), async (req, res) => {
    try {
        const { id } = req.params;

        const result = await query('DELETE FROM visitors WHERE id = $1 RETURNING *', [id]);

        if (!result.rows.length) {
            return res.status(404).json({ error: 'Посетитель не найден' });
        }

        res.json({ message: 'Посетитель успешно удален' });

    } catch (err) {
        console.error('Ошибка удаления посетителя:', err);
        res.status(500).json({ error: 'Ошибка сервера при удалении посетителя' });
    }
});

module.exports = router;