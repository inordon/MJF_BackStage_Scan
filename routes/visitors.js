const express = require('express');
const multer = require('multer');
const path = require('path');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator');
const { query, transaction } = require('../config/database');
const { requireAuth, requireRole, canModifyVisitor } = require('../middleware/auth');

const router = express.Router();

// Настройка загрузки файлов
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/photos');
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
    body('last_name')
        .trim()
        .isLength({ min: 2, max: 50 })
        .withMessage('Фамилия должна содержать от 2 до 50 символов')
        .matches(/^[а-яёА-ЯЁa-zA-Z\s-]+$/)
        .withMessage('Фамилия может содержать только буквы, пробелы и дефисы'),
    body('first_name')
        .trim()
        .isLength({ min: 2, max: 50 })
        .withMessage('Имя должно содержать от 2 до 50 символов')
        .matches(/^[а-яёА-ЯЁa-zA-Z\s-]+$/)
        .withMessage('Имя может содержать только буквы, пробелы и дефисы'),
    body('middle_name')
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

// Получить всех посетителей
router.get('/all', requireAuth, async (req, res) => {
    try {
        const { page = 1, limit = 50, status, search } = req.query;
        const offset = (page - 1) * limit;

        let queryText = `
            SELECT v.id, v.visitor_uuid, v.last_name, v.first_name, v.middle_name, 
                   v.comment, v.status, v.created_at, v.updated_at,
                   v.photo_path, v.qr_code_path,
                   creator.username as created_by_username,
                   updater.username as updated_by_username,
                   COUNT(s.id) as scan_count,
                   MAX(s.scanned_at) as last_scan
            FROM visitors v
            LEFT JOIN users creator ON v.created_by = creator.id
            LEFT JOIN users updater ON v.updated_by = updater.id
            LEFT JOIN scans s ON v.id = s.visitor_id
        `;

        const queryParams = [];
        const conditions = [];

        if (status && ['active', 'blocked'].includes(status)) {
            conditions.push(`v.status = $${queryParams.length + 1}`);
            queryParams.push(status);
        }

        if (search) {
            conditions.push(`(
                v.last_name ILIKE $${queryParams.length + 1} OR 
                v.first_name ILIKE $${queryParams.length + 1} OR 
                v.middle_name ILIKE $${queryParams.length + 1} OR
                v.comment ILIKE $${queryParams.length + 1}
            )`);
            queryParams.push(`%${search}%`);
        }

        if (conditions.length > 0) {
            queryText += ' WHERE ' + conditions.join(' AND ');
        }

        queryText += `
            GROUP BY v.id, creator.username, updater.username
            ORDER BY v.created_at DESC
            LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}
        `;

        queryParams.push(limit, offset);

        const result = await query(queryText, queryParams);

        // Получаем общее количество записей
        let countQuery = 'SELECT COUNT(*) as total FROM visitors v';
        const countParams = [];

        if (conditions.length > 0) {
            countQuery += ' WHERE ' + conditions.join(' AND ');
            countParams.push(...queryParams.slice(0, -2)); // Убираем limit и offset
        }

        const countResult = await query(countQuery, countParams);
        const total = parseInt(countResult.rows[0].total);

        res.json({
            visitors: result.rows.map(visitor => ({
                id: visitor.id,
                uuid: visitor.visitor_uuid,
                lastName: visitor.last_name,
                firstName: visitor.first_name,
                middleName: visitor.middle_name,
                fullName: `${visitor.last_name} ${visitor.first_name} ${visitor.middle_name || ''}`.trim(),
                comment: visitor.comment,
                status: visitor.status,
                createdAt: visitor.created_at,
                updatedAt: visitor.updated_at,
                photoPath: visitor.photo_path,
                qrCodePath: visitor.qr_code_path,
                createdByUsername: visitor.created_by_username,
                updatedByUsername: visitor.updated_by_username,
                scanCount: parseInt(visitor.scan_count || 0),
                lastScan: visitor.last_scan
            })),
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: total,
                pages: Math.ceil(total / limit)
            }
        });

    } catch (err) {
        console.error('Ошибка получения посетителей:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Получить посетителя по ID
router.get('/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;

        const result = await query(`
            SELECT v.*, 
                   creator.username as created_by_username,
                   updater.username as updated_by_username
            FROM visitors v
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
            uuid: visitor.visitor_uuid,
            lastName: visitor.last_name,
            firstName: visitor.first_name,
            middleName: visitor.middle_name,
            comment: visitor.comment,
            status: visitor.status,
            createdAt: visitor.created_at,
            updatedAt: visitor.updated_at,
            photoPath: visitor.photo_path,
            qrCodePath: visitor.qr_code_path,
            createdByUsername: visitor.created_by_username,
            updatedByUsername: visitor.updated_by_username
        });

    } catch (err) {
        console.error('Ошибка получения посетителя:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Создать нового посетителя
router.post('/create', requireAuth, upload.single('photo'), visitorValidation, async (req, res) => {
    try {
        // Проверка валидации
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Ошибки валидации',
                details: errors.array()
            });
        }

        const { last_name, first_name, middle_name, comment } = req.body;
        const photo_path = req.file ? req.file.path : null;
        const visitor_uuid = uuidv4();

        const result = await transaction(async (client) => {
            // Создаем посетителя
            const visitorResult = await client.query(`
                INSERT INTO visitors (
                    visitor_uuid, last_name, first_name, middle_name, 
                    comment, photo_path, status, created_by
                ) VALUES ($1, $2, $3, $4, $5, $6, 'active', $7)
                RETURNING id
            `, [
                visitor_uuid, last_name, first_name,
                middle_name, comment, photo_path, req.user.id
            ]);

            const visitorId = visitorResult.rows[0].id;

            // Генерируем QR код
            const qrData = JSON.stringify({
                uuid: visitor_uuid,
                name: `${last_name} ${first_name} ${middle_name || ''}`.trim(),
                timestamp: new Date().toISOString()
            });

            const qrCodePath = `uploads/qr-codes/visitor-${visitor_uuid}-qr.png`;

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

            return visitorId;
        });

        // Получаем созданного посетителя
        const createdVisitor = await query(
            'SELECT * FROM visitors WHERE id = $1',
            [result]
        );

        res.status(201).json({
            message: 'Посетитель успешно создан',
            visitor: {
                id: createdVisitor.rows[0].id,
                uuid: createdVisitor.rows[0].visitor_uuid,
                lastName: createdVisitor.rows[0].last_name,
                firstName: createdVisitor.rows[0].first_name,
                middleName: createdVisitor.rows[0].middle_name,
                comment: createdVisitor.rows[0].comment,
                status: createdVisitor.rows[0].status,
                photoPath: createdVisitor.rows[0].photo_path,
                qrCodePath: createdVisitor.rows[0].qr_code_path,
                createdAt: createdVisitor.rows[0].created_at
            }
        });

    } catch (err) {
        console.error('Ошибка создания посетителя:', err);
        res.status(500).json({ error: 'Ошибка сервера при создании посетителя' });
    }
});

// Обновить посетителя
router.put('/:id', requireAuth, canModifyVisitor, upload.single('photo'), visitorValidation, async (req, res) => {
    try {
        // Проверка валидации
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Ошибки валидации',
                details: errors.array()
            });
        }

        const { id } = req.params;
        const { last_name, first_name, middle_name, comment, status } = req.body;

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

        const result = await query(`
            UPDATE visitors SET 
                last_name = $1, first_name = $2, middle_name = $3, 
                comment = $4, photo_path = $5, status = $6,
                updated_at = CURRENT_TIMESTAMP, updated_by = $7
            WHERE id = $8
            RETURNING *
        `, [
            last_name, first_name, middle_name, comment,
            photo_path, finalStatus, req.user.id, id
        ]);

        res.json({
            message: 'Посетитель успешно обновлен',
            visitor: {
                id: result.rows[0].id,
                uuid: result.rows[0].visitor_uuid,
                lastName: result.rows[0].last_name,
                firstName: result.rows[0].first_name,
                middleName: result.rows[0].middle_name,
                comment: result.rows[0].comment,
                status: result.rows[0].status,
                photoPath: result.rows[0].photo_path,
                qrCodePath: result.rows[0].qr_code_path,
                updatedAt: result.rows[0].updated_at
            }
        });

    } catch (err) {
        console.error('Ошибка обновления посетителя:', err);
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
                updatedAt: result.rows[0].updated_at
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
                scanType: scan.scan_type,
                scannedAt: scan.scanned_at,
                ipAddress: scan.ip_address,
                userAgent: scan.user_agent,
                scannedByUsername: scan.scanned_by_username,
                scannedByName: scan.scanned_by_name
            })),
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: total,
                pages: Math.ceil(total / limit)
            }
        });

    } catch (err) {
        console.error('Ошибка получения истории сканирований:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Статистика посетителей
router.get('/stats/summary', requireAuth, async (req, res) => {
    try {
        const stats = await query(`
            SELECT 
                COUNT(*) as total_visitors,
                COUNT(CASE WHEN status = 'active' THEN 1 END) as active_visitors,
                COUNT(CASE WHEN status = 'blocked' THEN 1 END) as blocked_visitors,
                COUNT(CASE WHEN created_at::date = CURRENT_DATE THEN 1 END) as today_created
            FROM visitors
        `);

        const scanStats = await query(`
            SELECT 
                COUNT(*) as total_scans,
                COUNT(CASE WHEN scan_date = CURRENT_DATE THEN 1 END) as today_scans,
                COUNT(DISTINCT visitor_id) as unique_visitors_scanned
            FROM scans
        `);

        res.json({
            visitors: stats.rows[0],
            scans: scanStats.rows[0],
            timestamp: new Date()
        });

    } catch (err) {
        console.error('Ошибка получения статистики:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

module.exports = router;