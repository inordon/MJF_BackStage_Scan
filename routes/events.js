// routes/events.js - исправленная версия
const express = require('express');
const { body, validationResult } = require('express-validator');
const { query, transaction } = require('../config/database');
const { requireAuth, requireRole, canModifyVisitor } = require('../middleware/auth');

const router = express.Router();

// Валидация данных события
const eventValidation = [
    body('name')
        .trim()
        .isLength({ min: 3, max: 200 })
        .withMessage('Название должно содержать от 3 до 200 символов'),
    body('description')
        .optional()
        .trim()
        .isLength({ max: 1000 })
        .withMessage('Описание не должно превышать 1000 символов'),
    body('start_date')
        .isDate()
        .withMessage('Некорректная дата начала'),
    body('end_date')
        .isDate()
        .withMessage('Некорректная дата окончания'),
    body('location')
        .optional()
        .trim()
        .isLength({ max: 300 })
        .withMessage('Местоположение не должно превышать 300 символов'),
    body('max_participants')
        .optional()
        .isInt({ min: 1 })
        .withMessage('Максимальное количество участников должно быть положительным числом'),
    body('registration_required')
        .optional()
        .isBoolean()
        .withMessage('registration_required должно быть булевым значением')
];

// Получить все события
router.get('/', requireAuth, async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.max(1, Math.min(100, parseInt(req.query.limit) || 50));
        const offset = (page - 1) * limit;

        const status = req.query.status && ['active', 'inactive', 'completed', 'cancelled'].includes(req.query.status) ? req.query.status : null;
        const active_only = req.query.active_only === 'true';

        console.log('Параметры запроса событий:', { page, limit, offset, status, active_only });

        // Основной запрос с проверкой существования представления events_stats
        let queryText = `
            SELECT e.*,
                   creator.full_name as created_by_name,
                   COUNT(v.id) as total_visitors,
                   COUNT(CASE WHEN v.status = 'active' THEN 1 END) as active_visitors,
                   COUNT(CASE WHEN v.status = 'blocked' THEN 1 END) as blocked_visitors,
                   COUNT(s.id) as total_scans,
                   COUNT(CASE WHEN s.scan_date = CURRENT_DATE THEN 1 END) as today_scans,
                   COUNT(DISTINCT CASE WHEN s.scan_type = 'first' THEN s.visitor_id END) as unique_visitors_scanned
            FROM events e
                     LEFT JOIN users creator ON e.created_by = creator.id
                     LEFT JOIN visitors v ON e.id = v.event_id
                     LEFT JOIN scans s ON v.id = s.visitor_id
        `;

        const conditions = [];
        const params = [];

        if (status) {
            conditions.push(`e.status = $${params.length + 1}`);
            params.push(status);
        }

        if (active_only) {
            conditions.push(`e.status = 'active' AND e.end_date >= CURRENT_DATE`);
        }

        if (conditions.length > 0) {
            queryText += ' WHERE ' + conditions.join(' AND ');
        }

        queryText += `
            GROUP BY e.id, creator.full_name
            ORDER BY e.start_date DESC
            LIMIT $${params.length + 1} OFFSET $${params.length + 2}
        `;

        params.push(limit, offset);

        console.log('SQL запрос событий:', queryText);
        console.log('Параметры:', params);

        const result = await query(queryText, params);

        // Получаем общее количество
        let countQuery = 'SELECT COUNT(*) as total FROM events e';
        const countParams = [];

        if (conditions.length > 0) {
            countQuery += ' WHERE ' + conditions.join(' AND ');
            countParams.push(...params.slice(0, -2)); // Убираем limit и offset
        }

        const countResult = await query(countQuery, countParams);
        const total = parseInt(countResult.rows[0].total);

        console.log(`Найдено событий: ${result.rows.length}, всего: ${total}`);

        res.json({
            events: result.rows.map(event => ({
                id: event.id,
                event_uuid: event.event_uuid,
                name: event.name,
                description: event.description,
                start_date: event.start_date,
                end_date: event.end_date,
                location: event.location,
                status: event.status,
                max_participants: event.max_participants,
                registration_required: event.registration_required,
                created_at: event.created_at,
                updated_at: event.updated_at,
                created_by_name: event.created_by_name,
                stats: {
                    total_visitors: parseInt(event.total_visitors || 0),
                    active_visitors: parseInt(event.active_visitors || 0),
                    blocked_visitors: parseInt(event.blocked_visitors || 0),
                    total_scans: parseInt(event.total_scans || 0),
                    today_scans: parseInt(event.today_scans || 0),
                    unique_visitors_scanned: parseInt(event.unique_visitors_scanned || 0)
                }
            })),
            pagination: {
                page: page,
                limit: limit,
                total: total,
                pages: Math.ceil(total / limit)
            }
        });

    } catch (err) {
        console.error('Ошибка получения событий:', err);
        console.error('Стек ошибки:', err.stack);
        res.status(500).json({
            error: 'Ошибка сервера при получении событий',
            details: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
});

// Получить событие по ID
router.get('/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;

        const result = await query(`
            SELECT e.*,
                   creator.full_name as created_by_name,
                   updater.full_name as updated_by_name
            FROM events e
                     LEFT JOIN users creator ON e.created_by = creator.id
                     LEFT JOIN users updater ON e.updated_by = updater.id
            WHERE e.id = $1
        `, [id]);

        if (!result.rows.length) {
            return res.status(404).json({ error: 'Событие не найдено' });
        }

        const event = result.rows[0];

        // Получаем детальную статистику
        const statsResult = await query(`
            SELECT 
                COUNT(v.id) as total_visitors,
                COUNT(CASE WHEN v.status = 'active' THEN 1 END) as active_visitors,
                COUNT(CASE WHEN v.status = 'blocked' THEN 1 END) as blocked_visitors,
                COUNT(s.id) as total_scans,
                COUNT(CASE WHEN s.scan_date = CURRENT_DATE THEN 1 END) as today_scans,
                COUNT(DISTINCT CASE WHEN s.scan_type = 'first' THEN s.visitor_id END) as unique_visitors_scanned
            FROM visitors v
            LEFT JOIN scans s ON v.id = s.visitor_id
            WHERE v.event_id = $1
        `, [id]);

        const stats = statsResult.rows[0] || {};

        res.json({
            id: event.id,
            event_uuid: event.event_uuid,
            name: event.name,
            description: event.description,
            start_date: event.start_date,
            end_date: event.end_date,
            location: event.location,
            status: event.status,
            max_participants: event.max_participants,
            registration_required: event.registration_required,
            created_at: event.created_at,
            updated_at: event.updated_at,
            created_by_name: event.created_by_name,
            updated_by_name: event.updated_by_name,
            stats: {
                total_visitors: parseInt(stats.total_visitors || 0),
                active_visitors: parseInt(stats.active_visitors || 0),
                blocked_visitors: parseInt(stats.blocked_visitors || 0),
                total_scans: parseInt(stats.total_scans || 0),
                today_scans: parseInt(stats.today_scans || 0),
                unique_visitors_scanned: parseInt(stats.unique_visitors_scanned || 0)
            }
        });

    } catch (err) {
        console.error('Ошибка получения события:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Создать новое событие
router.post('/', requireAuth, requireRole(['admin', 'moderator']), eventValidation, async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Ошибки валидации',
                details: errors.array()
            });
        }

        const {
            name,
            description,
            start_date,
            end_date,
            location,
            max_participants,
            registration_required
        } = req.body;

        // Проверяем что дата окончания не раньше даты начала
        if (new Date(end_date) < new Date(start_date)) {
            return res.status(400).json({
                error: 'Дата окончания не может быть раньше даты начала'
            });
        }

        const result = await query(`
            INSERT INTO events (
                name, description, start_date, end_date, location,
                max_participants, registration_required, created_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                RETURNING *
        `, [
            name, description, start_date, end_date, location,
            max_participants, registration_required || false, req.user.id
        ]);

        res.status(201).json({
            message: 'Событие успешно создано',
            event: {
                id: result.rows[0].id,
                event_uuid: result.rows[0].event_uuid,
                name: result.rows[0].name,
                description: result.rows[0].description,
                start_date: result.rows[0].start_date,
                end_date: result.rows[0].end_date,
                location: result.rows[0].location,
                status: result.rows[0].status,
                max_participants: result.rows[0].max_participants,
                registration_required: result.rows[0].registration_required,
                created_at: result.rows[0].created_at
            }
        });

    } catch (err) {
        console.error('Ошибка создания события:', err);
        res.status(500).json({ error: 'Ошибка сервера при создании события' });
    }
});

// Обновить событие
router.put('/:id', requireAuth, requireRole(['admin', 'moderator']), eventValidation, async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Ошибки валидации',
                details: errors.array()
            });
        }

        const { id } = req.params;
        const {
            name,
            description,
            start_date,
            end_date,
            location,
            status,
            max_participants,
            registration_required
        } = req.body;

        // Проверяем существование события
        const existingEvent = await query('SELECT * FROM events WHERE id = $1', [id]);
        if (!existingEvent.rows.length) {
            return res.status(404).json({ error: 'Событие не найдено' });
        }

        // Проверяем что дата окончания не раньше даты начала
        if (new Date(end_date) < new Date(start_date)) {
            return res.status(400).json({
                error: 'Дата окончания не может быть раньше даты начала'
            });
        }

        const result = await query(`
            UPDATE events SET
                              name = $1, description = $2, start_date = $3, end_date = $4,
                              location = $5, status = $6, max_participants = $7,
                              registration_required = $8, updated_at = CURRENT_TIMESTAMP,
                              updated_by = $9
            WHERE id = $10
                RETURNING *
        `, [
            name, description, start_date, end_date, location,
            status || existingEvent.rows[0].status,
            max_participants, registration_required,
            req.user.id, id
        ]);

        res.json({
            message: 'Событие успешно обновлено',
            event: {
                id: result.rows[0].id,
                event_uuid: result.rows[0].event_uuid,
                name: result.rows[0].name,
                description: result.rows[0].description,
                start_date: result.rows[0].start_date,
                end_date: result.rows[0].end_date,
                location: result.rows[0].location,
                status: result.rows[0].status,
                max_participants: result.rows[0].max_participants,
                registration_required: result.rows[0].registration_required,
                updated_at: result.rows[0].updated_at
            }
        });

    } catch (err) {
        console.error('Ошибка обновления события:', err);
        res.status(500).json({ error: 'Ошибка сервера при обновлении события' });
    }
});

// Изменить статус события
router.patch('/:id/status', requireAuth, requireRole(['admin', 'moderator']), async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        if (!['active', 'inactive', 'completed', 'cancelled'].includes(status)) {
            return res.status(400).json({ error: 'Некорректный статус' });
        }

        const result = await query(`
            UPDATE events SET
                              status = $1,
                              updated_at = CURRENT_TIMESTAMP,
                              updated_by = $2
            WHERE id = $3
                RETURNING *
        `, [status, req.user.id, id]);

        if (!result.rows.length) {
            return res.status(404).json({ error: 'Событие не найдено' });
        }

        res.json({
            message: `Статус события изменен на "${status}"`,
            event: {
                id: result.rows[0].id,
                status: result.rows[0].status,
                updated_at: result.rows[0].updated_at
            }
        });

    } catch (err) {
        console.error('Ошибка изменения статуса события:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Удалить событие (только для администраторов)
router.delete('/:id', requireAuth, requireRole(['admin']), async (req, res) => {
    try {
        const { id } = req.params;

        // Проверяем есть ли привязанные посетители
        const visitorsCheck = await query(
            'SELECT COUNT(*) as count FROM visitors WHERE event_id = $1',
            [id]
        );

        if (parseInt(visitorsCheck.rows[0].count) > 0) {
            return res.status(400).json({
                error: 'Нельзя удалить событие с привязанными посетителями'
            });
        }

        const result = await query('DELETE FROM events WHERE id = $1 RETURNING name', [id]);

        if (!result.rows.length) {
            return res.status(404).json({ error: 'Событие не найдено' });
        }

        res.json({
            message: 'Событие успешно удалено',
            deletedEvent: result.rows[0].name
        });

    } catch (err) {
        console.error('Ошибка удаления события:', err);
        res.status(500).json({ error: 'Ошибка сервера при удалении события' });
    }
});

// Получить посетителей события
router.get('/:id/visitors', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.max(1, Math.min(100, parseInt(req.query.limit) || 50));
        const offset = (page - 1) * limit;

        const status = req.query.status && ['active', 'blocked'].includes(req.query.status) ? req.query.status : null;
        const search = req.query.search ? req.query.search.trim() : null;

        // Проверяем существование события
        const eventCheck = await query('SELECT name FROM events WHERE id = $1', [id]);
        if (!eventCheck.rows.length) {
            return res.status(404).json({ error: 'Событие не найдено' });
        }

        let queryText = `
            SELECT v.*, creator.full_name as created_by_name,
                   COUNT(s.id) as total_scans,
                   MAX(s.scanned_at) as last_scan
            FROM visitors v
            LEFT JOIN users creator ON v.created_by = creator.id
            LEFT JOIN scans s ON v.id = s.visitor_id
            WHERE v.event_id = $1
        `;

        const params = [id];
        const conditions = [];

        if (status) {
            conditions.push(`v.status = $${params.length + 1}`);
            params.push(status);
        }

        if (search && search.length > 0) {
            conditions.push(`(
                v.last_name ILIKE $${params.length + 1} OR 
                v.first_name ILIKE $${params.length + 1} OR 
                v.middle_name ILIKE $${params.length + 1}
            )`);
            params.push(`%${search}%`);
        }

        if (conditions.length > 0) {
            queryText += ' AND ' + conditions.join(' AND ');
        }

        queryText += `
            GROUP BY v.id, creator.full_name
            ORDER BY v.created_at DESC
            LIMIT $${params.length + 1} OFFSET $${params.length + 2}
        `;

        params.push(limit, offset);

        const result = await query(queryText, params);

        // Получаем общее количество
        let countQuery = 'SELECT COUNT(*) as total FROM visitors v WHERE v.event_id = $1';
        const countParams = [id];
        if (conditions.length > 0) {
            countQuery += ' AND ' + conditions.join(' AND ');
            countParams.push(...params.slice(1, -2));
        }
        const countResult = await query(countQuery, countParams);
        const total = parseInt(countResult.rows[0].total);

        res.json({
            eventName: eventCheck.rows[0].name,
            visitors: result.rows.map(visitor => ({
                id: visitor.id,
                visitor_uuid: visitor.visitor_uuid,
                last_name: visitor.last_name,
                first_name: visitor.first_name,
                middle_name: visitor.middle_name,
                comment: visitor.comment,
                status: visitor.status,
                created_at: visitor.created_at,
                created_by_name: visitor.created_by_name,
                total_scans: parseInt(visitor.total_scans || 0),
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
        console.error('Ошибка получения посетителей события:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Статистика события
router.get('/:id/stats', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;

        const statsResult = await query(`
            SELECT 
                COUNT(v.id) as total_visitors,
                COUNT(CASE WHEN v.status = 'active' THEN 1 END) as active_visitors,
                COUNT(CASE WHEN v.status = 'blocked' THEN 1 END) as blocked_visitors,
                COUNT(s.id) as total_scans,
                COUNT(CASE WHEN s.scan_date = CURRENT_DATE THEN 1 END) as today_scans,
                COUNT(DISTINCT CASE WHEN s.scan_type = 'first' THEN s.visitor_id END) as unique_visitors_scanned
            FROM visitors v
            LEFT JOIN scans s ON v.id = s.visitor_id
            WHERE v.event_id = $1
        `, [id]);

        if (!statsResult.rows.length) {
            return res.status(404).json({ error: 'Событие не найдено' });
        }

        const stats = statsResult.rows[0];

        res.json({
            eventId: parseInt(id),
            stats: {
                total_visitors: parseInt(stats.total_visitors || 0),
                active_visitors: parseInt(stats.active_visitors || 0),
                blocked_visitors: parseInt(stats.blocked_visitors || 0),
                total_scans: parseInt(stats.total_scans || 0),
                today_scans: parseInt(stats.today_scans || 0),
                unique_visitors_scanned: parseInt(stats.unique_visitors_scanned || 0)
            },
            timestamp: new Date()
        });

    } catch (err) {
        console.error('Ошибка получения статистики события:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

module.exports = router;