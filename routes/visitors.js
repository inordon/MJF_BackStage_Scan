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
        const uploadPath = 'uploads/photos';
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

// Валидация данных посетителя
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
        .withMessage('Комментарий не должен превышать 500 символов')
];

// Функция генерации штрихкода
function generateBarcode() {
    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
    const randomNum = Math.floor(Math.random() * 9000) + 1000;
    return `VIS${dateStr}${randomNum}`;
}

// ================================
// API ENDPOINTS ДЛЯ СОБЫТИЙ
// ================================

// ИСПРАВЛЕНИЕ: Добавляем отсутствующий endpoint для активных событий
router.get('/events/active', requireAuth, async (req, res) => {
    try {
        console.log('🎯 Запрос активных событий для фильтра');

        const result = await query(`
            SELECT id, name, start_date, end_date, location
            FROM events 
            WHERE status = 'active' 
              AND end_date >= CURRENT_DATE
            ORDER BY start_date ASC
        `);

        console.log(`✅ Найдено активных событий: ${result.rows.length}`);

        res.json({
            success: true,
            events: result.rows.map(event => ({
                id: event.id,
                name: event.name,
                start_date: event.start_date,
                end_date: event.end_date,
                location: event.location
            }))
        });

    } catch (err) {
        console.error('❌ Ошибка получения активных событий:', err);
        res.status(500).json({
            success: false,
            error: 'Ошибка сервера при получении событий',
            events: []
        });
    }
});

// ================================
// ОСНОВНЫЕ ENDPOINTS ДЛЯ ПОСЕТИТЕЛЕЙ
// ================================

// ИСПРАВЛЕНИЕ: Получить всех посетителей с полной информацией
router.get('/', requireAuth, async (req, res) => {
    try {
        const { page = 1, limit = 50, status, search, event_id } = req.query;
        const offset = (page - 1) * limit;

        console.log('📋 Запрос списка посетителей:', { page, limit, status, search, event_id });

        // ИСПРАВЛЕНИЕ: Добавляем barcode в SELECT и JOIN с событиями
        let queryText = `
            SELECT v.id, v.visitor_uuid, v.last_name, v.first_name, v.middle_name,
                   v.comment, v.barcode, v.status, v.created_at, v.updated_at,
                   v.photo_path, v.qr_code_path, v.event_id,
                   creator.full_name as created_by_name,
                   e.name as event_name,
                   e.start_date as event_start_date,
                   e.end_date as event_end_date,
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

        if (status && ['active', 'blocked'].includes(status)) {
            conditions.push(`v.status = $${queryParams.length + 1}`);
            queryParams.push(status);
        }

        if (event_id && !isNaN(parseInt(event_id))) {
            conditions.push(`v.event_id = $${queryParams.length + 1}`);
            queryParams.push(parseInt(event_id));
        }

        if (search) {
            conditions.push(`(
                v.last_name ILIKE $${queryParams.length + 1} OR 
                v.first_name ILIKE $${queryParams.length + 1} OR 
                v.middle_name ILIKE $${queryParams.length + 1} OR
                v.comment ILIKE $${queryParams.length + 1} OR
                v.barcode ILIKE $${queryParams.length + 1}
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

        console.log('🔍 Выполняем SQL запрос посетителей');
        const result = await query(queryText, queryParams);

        // Получаем общее количество записей
        let countQuery = 'SELECT COUNT(*) as total FROM visitors v';
        const countParams = [];

        if (conditions.length > 0) {
            countQuery += ' LEFT JOIN events e ON v.event_id = e.id WHERE ' + conditions.join(' AND ');
            countParams.push(...queryParams.slice(0, -2)); // Убираем limit и offset
        }

        const countResult = await query(countQuery, countParams);
        const total = parseInt(countResult.rows[0].total);

        console.log(`✅ Найдено посетителей: ${result.rows.length}, всего: ${total}`);

        // ИСПРАВЛЕНИЕ: Формируем правильный ответ с полной информацией
        const visitors = result.rows.map(visitor => ({
            id: visitor.id,
            visitor_uuid: visitor.visitor_uuid,
            last_name: visitor.last_name,
            first_name: visitor.first_name,
            middle_name: visitor.middle_name,
            comment: visitor.comment,
            barcode: visitor.barcode, // ИСПРАВЛЕНИЕ: Добавляем barcode
            status: visitor.status,
            created_at: visitor.created_at,
            updated_at: visitor.updated_at,
            photo_path: visitor.photo_path,
            qr_code_path: visitor.qr_code_path,
            created_by_name: visitor.created_by_name,
            // ИСПРАВЛЕНИЕ: Добавляем информацию о событии
            event: visitor.event_name ? {
                id: visitor.event_id,
                name: visitor.event_name,
                start_date: visitor.event_start_date,
                end_date: visitor.event_end_date
            } : null,
            total_scans: parseInt(visitor.total_scans || 0),
            first_scan_today: parseInt(visitor.first_scan_today || 0) > 0,
            last_scan: visitor.last_scan
        }));

        res.json({
            visitors: visitors,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: total,
                pages: Math.ceil(total / limit)
            }
        });

    } catch (err) {
        console.error('❌ Ошибка получения посетителей:', err);
        res.status(500).json({ error: 'Ошибка сервера при получении посетителей' });
    }
});

// Получить посетителя по ID
router.get('/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;

        const result = await query(`
            SELECT v.*, e.name as event_name,
                   creator.full_name as created_by_name,
                   updater.full_name as updated_by_name
            FROM visitors v
                     LEFT JOIN events e ON v.event_id = e.id
                     LEFT JOIN users creator ON v.created_by = creator.id
                     LEFT JOIN users updater ON v.updated_by = updater.id
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
            barcode: visitor.barcode, // ИСПРАВЛЕНИЕ: Добавляем barcode
            status: visitor.status,
            created_at: visitor.created_at,
            updated_at: visitor.updated_at,
            photo_path: visitor.photo_path,
            qr_code_path: visitor.qr_code_path,
            event_name: visitor.event_name,
            created_by_name: visitor.created_by_name,
            updated_by_name: visitor.updated_by_name
        });

    } catch (err) {
        console.error('❌ Ошибка получения посетителя:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ИСПРАВЛЕНИЕ: Создать нового посетителя с правильной генерацией barcode
router.post('/', requireAuth, upload.single('photo'), visitorValidation, async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Ошибки валидации',
                details: errors.array()
            });
        }

        const { lastName, firstName, middleName, comment, eventId, barcode } = req.body;
        const photo_path = req.file ? req.file.path : null;
        const visitor_uuid = uuidv4();

        // ИСПРАВЛЕНИЕ: Генерируем barcode если не передан
        const finalBarcode = barcode && barcode.trim() ? barcode.trim() : generateBarcode();

        console.log('➕ Создание посетителя:', {
            name: `${lastName} ${firstName}`,
            eventId,
            barcode: finalBarcode
        });

        const result = await transaction(async (client) => {
            // Проверяем уникальность barcode
            if (finalBarcode) {
                const barcodeCheck = await client.query(
                    'SELECT id FROM visitors WHERE barcode = $1',
                    [finalBarcode]
                );

                if (barcodeCheck.rows.length > 0) {
                    throw new Error('Посетитель с таким штрихкодом уже существует');
                }
            }

            // Создаем посетителя
            const visitorResult = await client.query(`
                INSERT INTO visitors (
                    visitor_uuid, last_name, first_name, middle_name,
                    comment, photo_path, barcode, event_id, status, created_by
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9)
                    RETURNING id, visitor_uuid, barcode
            `, [
                visitor_uuid, lastName, firstName, middleName,
                comment, photo_path, finalBarcode,
                eventId ? parseInt(eventId) : null,
                req.user.id
            ]);

            const visitorId = visitorResult.rows[0].id;
            const createdBarcode = visitorResult.rows[0].barcode;

            // Генерируем QR код
            const qrData = `${req.protocol}://${req.get('host')}/scan/${visitor_uuid}`;

            const qrCodeDir = 'uploads/qr-codes';
            ensureDirectoryExists(qrCodeDir);
            const qrCodePath = `${qrCodeDir}/visitor-${visitor_uuid}-qr.png`;

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

            // Обновляем путь к QR коду
            await client.query(
                'UPDATE visitors SET qr_code_path = $1 WHERE id = $2',
                [qrCodePath, visitorId]
            );

            return { visitorId, createdBarcode };
        });

        // Получаем созданного посетителя с полной информацией
        const createdVisitorResult = await query(`
            SELECT v.*, e.name as event_name
            FROM visitors v
            LEFT JOIN events e ON v.event_id = e.id
            WHERE v.id = $1
        `, [result.visitorId]);

        const createdVisitor = createdVisitorResult.rows[0];

        console.log('✅ Посетитель создан успешно:', createdVisitor.barcode);

        res.status(201).json({
            message: 'Посетитель успешно создан',
            visitor: {
                id: createdVisitor.id,
                visitor_uuid: createdVisitor.visitor_uuid,
                last_name: createdVisitor.last_name,
                first_name: createdVisitor.first_name,
                middle_name: createdVisitor.middle_name,
                comment: createdVisitor.comment,
                barcode: createdVisitor.barcode, // ИСПРАВЛЕНИЕ: Возвращаем barcode
                status: createdVisitor.status,
                photo_path: createdVisitor.photo_path,
                qr_code_path: createdVisitor.qr_code_path,
                event_name: createdVisitor.event_name,
                created_at: createdVisitor.created_at
            }
        });

    } catch (err) {
        console.error('❌ Ошибка создания посетителя:', err);

        if (err.message.includes('уже существует')) {
            return res.status(400).json({ error: err.message });
        }

        res.status(500).json({ error: 'Ошибка сервера при создании посетителя' });
    }
});

// Обновить посетителя
router.put('/:id', requireAuth, canModifyVisitor, upload.single('photo'), visitorValidation, async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Ошибки валидации',
                details: errors.array()
            });
        }

        const { id } = req.params;
        const { lastName, firstName, middleName, comment, status, barcode } = req.body;

        // Проверяем существование посетителя
        const existingVisitor = await query('SELECT * FROM visitors WHERE id = $1', [id]);

        if (!existingVisitor.rows.length) {
            return res.status(404).json({ error: 'Посетитель не найден' });
        }

        const photo_path = req.file ? req.file.path : existingVisitor.rows[0].photo_path;

        // Проверяем права на изменение статуса
        if (status && !['admin', 'moderator'].includes(req.user.role)) {
            return res.status(403).json({ error: 'Недостаточно прав для изменения статуса' });
        }

        const finalStatus = status || existingVisitor.rows[0].status;
        const finalBarcode = barcode || existingVisitor.rows[0].barcode;

        const result = await query(`
            UPDATE visitors SET
                                last_name = $1, first_name = $2, middle_name = $3,
                                comment = $4, photo_path = $5, status = $6, barcode = $7,
                                updated_at = CURRENT_TIMESTAMP, updated_by = $8
            WHERE id = $9
                RETURNING *
        `, [
            lastName, firstName, middleName, comment,
            photo_path, finalStatus, finalBarcode, req.user.id, id
        ]);

        res.json({
            message: 'Посетитель успешно обновлен',
            visitor: {
                id: result.rows[0].id,
                visitor_uuid: result.rows[0].visitor_uuid,
                last_name: result.rows[0].last_name,
                first_name: result.rows[0].first_name,
                middle_name: result.rows[0].middle_name,
                comment: result.rows[0].comment,
                barcode: result.rows[0].barcode,
                status: result.rows[0].status,
                photo_path: result.rows[0].photo_path,
                qr_code_path: result.rows[0].qr_code_path,
                updated_at: result.rows[0].updated_at
            }
        });

    } catch (err) {
        console.error('❌ Ошибка обновления посетителя:', err);
        res.status(500).json({ error: 'Ошибка сервера при обновлении посетителя' });
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
        console.error('❌ Ошибка изменения статуса посетителя:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ИСПРАВЛЕНИЕ: Получить QR код посетителя
router.get('/:id/qr', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;

        const result = await query(
            'SELECT qr_code_path, visitor_uuid, last_name, first_name, middle_name, barcode FROM visitors WHERE id = $1',
            [id]
        );

        if (!result.rows.length) {
            return res.status(404).json({ error: 'Посетитель не найден' });
        }

        const visitor = result.rows[0];

        if (visitor.qr_code_path && fs.existsSync(visitor.qr_code_path)) {
            res.sendFile(path.resolve(visitor.qr_code_path));
        } else {
            // Генерируем QR код на лету, если файл не найден
            const qrData = `${req.protocol}://${req.get('host')}/scan/${visitor.visitor_uuid}`;

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
        console.error('❌ Ошибка получения QR кода:', err);
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
        console.error('❌ Ошибка удаления посетителя:', err);
        res.status(500).json({ error: 'Ошибка сервера при удалении посетителя' });
    }
});

// Получить историю сканирований посетителя
router.get('/:id/scans', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { page = 1, limit = 20 } = req.query;
        const offset = (page - 1) * limit;

        const result = await query(`
            SELECT s.id, s.scan_type, s.scanned_at, s.ip_address, s.user_agent,
                   u.username as scanned_by_username, u.full_name as scanned_by_name
            FROM scans s
                     LEFT JOIN users u ON s.scanned_by = u.id
            WHERE s.visitor_id = $1
            ORDER BY s.scanned_at DESC
                LIMIT $2 OFFSET $3
        `, [id, limit, offset]);

        const countResult = await query(
            'SELECT COUNT(*) as total FROM scans WHERE visitor_id = $1',
            [id]
        );

        const total = parseInt(countResult.rows[0].total);

        res.json({
            scans: result.rows.map(scan => ({
                id: scan.id,
                scan_type: scan.scan_type,
                scanned_at: scan.scanned_at,
                ip_address: scan.ip_address,
                user_agent: scan.user_agent,
                scanned_by_username: scan.scanned_by_username,
                scanned_by_name: scan.scanned_by_name
            })),
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: total,
                pages: Math.ceil(total / limit)
            }
        });

    } catch (err) {
        console.error('❌ Ошибка получения истории сканирований:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Статистика посетителей
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
            recentActivity: recentActivity.rows,
            timestamp: new Date()
        });

    } catch (err) {
        console.error('❌ Ошибка получения статистики:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

module.exports = router;