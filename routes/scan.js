const express = require('express');
const { query } = require('../config/database');
const { requireScanAuth, validateVisitorUUID } = require('../middleware/auth');

const router = express.Router();

// Сканирование QR кода посетителя
router.get('/:uuid', validateVisitorUUID, requireScanAuth, async (req, res) => {
    try {
        const { uuid } = req.params;
        const userId = req.user.id;

        // Получаем данные посетителя по UUID
        const visitorResult = await query(
            'SELECT id, last_name, first_name, middle_name, comment, status FROM visitors WHERE visitor_uuid = $1',
            [uuid]
        );

        // Если посетитель не найден
        if (!visitorResult.rows.length) {
            return res.json({
                status: 'error',
                type: 'not_found',
                icon: '❌',
                title: 'ПРОХОД ЗАПРЕЩЕН',
                message: 'QR код не найден в базе данных',
                timestamp: new Date().toISOString()
            });
        }

        const visitor = visitorResult.rows[0];

        // Если посетитель заблокирован
        if (visitor.status === 'blocked') {
            // Все равно записываем попытку сканирования
            await query(`
                INSERT INTO scans (visitor_id, scan_type, scanned_by, ip_address, user_agent)
                VALUES ($1, 'blocked_attempt', $2, $3, $4)
            `, [
                visitor.id,
                userId,
                req.ip,
                req.get('User-Agent')
            ]);

            return res.json({
                status: 'error',
                type: 'blocked',
                icon: '❌',
                title: 'ПРОХОД ЗАПРЕЩЕН',
                message: 'Посетитель заблокирован',
                visitor: {
                    name: `${visitor.last_name} ${visitor.first_name} ${visitor.middle_name || ''}`.trim(),
                    comment: visitor.comment
                },
                timestamp: new Date().toISOString()
            });
        }

        const fullName = `${visitor.last_name} ${visitor.first_name} ${visitor.middle_name || ''}`.trim();

        // Проверяем сканирования за сегодня
        const todayScansResult = await query(`
            SELECT scanned_at, scan_type
            FROM scans 
            WHERE visitor_id = $1 AND scan_date = CURRENT_DATE 
            ORDER BY scanned_at ASC
        `, [visitor.id]);

        const isFirstScanToday = todayScansResult.rows.length === 0;

        // Определяем тип сканирования
        let scanType;
        if (isFirstScanToday) {
            scanType = 'first';
        } else {
            // Проверяем, было ли уже сканирование в последние 30 минут
            const recentScans = todayScansResult.rows.filter(scan => {
                const scanTime = new Date(scan.scanned_at);
                const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
                return scanTime > thirtyMinutesAgo;
            });

            scanType = recentScans.length > 0 ? 'duplicate' : 'repeat';
        }

        // Записываем новое сканирование
        const newScanResult = await query(`
            INSERT INTO scans (visitor_id, scan_type, scanned_by, ip_address, user_agent)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING scanned_at
        `, [
            visitor.id,
            scanType,
            userId,
            req.ip,
            req.get('User-Agent')
        ]);

        const scanTime = newScanResult.rows[0].scanned_at;

        // Формируем ответ в зависимости от типа сканирования
        if (scanType === 'first') {
            res.json({
                status: 'success',
                type: 'first_scan',
                icon: '✅',
                title: fullName,
                comment: visitor.comment,
                scanTime: scanTime,
                message: 'Добро пожаловать! Первое сканирование за день',
                timestamp: new Date().toISOString()
            });
        } else if (scanType === 'repeat') {
            const firstScanTime = todayScansResult.rows[0].scanned_at;

            res.json({
                status: 'warning',
                type: 'repeat_scan',
                icon: '⚠️',
                title: fullName,
                comment: visitor.comment,
                firstScanTime: firstScanTime,
                currentScanTime: scanTime,
                message: 'Повторное сканирование',
                scanCount: todayScansResult.rows.length + 1,
                timestamp: new Date().toISOString()
            });
        } else { // duplicate
            const lastScanTime = todayScansResult.rows[todayScansResult.rows.length - 1].scanned_at;

            res.json({
                status: 'info',
                type: 'duplicate_scan',
                icon: 'ℹ️',
                title: fullName,
                comment: visitor.comment,
                lastScanTime: lastScanTime,
                currentScanTime: scanTime,
                message: 'Дублирующее сканирование (менее 30 минут назад)',
                scanCount: todayScansResult.rows.length + 1,
                timestamp: new Date().toISOString()
            });
        }

    } catch (err) {
        console.error('Ошибка сканирования QR кода:', err);

        res.json({
            status: 'error',
            type: 'system_error',
            icon: 'ℹ️',
            title: 'Обратитесь к организатору',
            message: 'Произошла техническая ошибка при сканировании',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined,
            timestamp: new Date().toISOString()
        });
    }
});

// Массовое сканирование (для тестирования)
router.post('/batch', requireScanAuth, async (req, res) => {
    try {
        const { uuids } = req.body;

        if (!Array.isArray(uuids) || uuids.length === 0) {
            return res.status(400).json({ error: 'Требуется массив UUID посетителей' });
        }

        if (uuids.length > 10) {
            return res.status(400).json({ error: 'Максимум 10 UUID за раз' });
        }

        const results = [];

        for (const uuid of uuids) {
            try {
                // Используем тот же алгоритм, что и для одиночного сканирования
                const visitorResult = await query(
                    'SELECT id, last_name, first_name, middle_name, comment, status FROM visitors WHERE visitor_uuid = $1',
                    [uuid]
                );

                if (!visitorResult.rows.length) {
                    results.push({
                        uuid,
                        status: 'error',
                        message: 'Посетитель не найден'
                    });
                    continue;
                }

                const visitor = visitorResult.rows[0];

                if (visitor.status === 'blocked') {
                    results.push({
                        uuid,
                        status: 'blocked',
                        message: 'Посетитель заблокирован',
                        name: `${visitor.last_name} ${visitor.first_name} ${visitor.middle_name || ''}`.trim()
                    });
                    continue;
                }

                // Записываем сканирование
                const scanResult = await query(`
                    INSERT INTO scans (visitor_id, scan_type, scanned_by, ip_address, user_agent)
                    VALUES ($1, 'batch', $2, $3, $4)
                    RETURNING scanned_at
                `, [
                    visitor.id,
                    req.user.id,
                    req.ip,
                    req.get('User-Agent')
                ]);

                results.push({
                    uuid,
                    status: 'success',
                    message: 'Сканирование успешно',
                    name: `${visitor.last_name} ${visitor.first_name} ${visitor.middle_name || ''}`.trim(),
                    scanTime: scanResult.rows[0].scanned_at
                });

            } catch (err) {
                console.error(`Ошибка сканирования UUID ${uuid}:`, err);
                results.push({
                    uuid,
                    status: 'error',
                    message: 'Ошибка при сканировании'
                });
            }
        }

        res.json({
            success: true,
            results: results,
            summary: {
                total: results.length,
                successful: results.filter(r => r.status === 'success').length,
                blocked: results.filter(r => r.status === 'blocked').length,
                errors: results.filter(r => r.status === 'error').length
            },
            timestamp: new Date().toISOString()
        });

    } catch (err) {
        console.error('Ошибка массового сканирования:', err);
        res.status(500).json({ error: 'Ошибка сервера при массовом сканировании' });
    }
});

// Получить статистику сканирований за день
router.get('/stats/daily', requireScanAuth, async (req, res) => {
    try {
        const { date } = req.query;
        const targetDate = date ? new Date(date) : new Date();

        const stats = await query(`
            SELECT 
                COUNT(*) as total_scans,
                COUNT(DISTINCT visitor_id) as unique_visitors,
                COUNT(CASE WHEN scan_type = 'first' THEN 1 END) as first_scans,
                COUNT(CASE WHEN scan_type = 'repeat' THEN 1 END) as repeat_scans,
                COUNT(CASE WHEN scan_type = 'duplicate' THEN 1 END) as duplicate_scans,
                COUNT(CASE WHEN scan_type = 'blocked_attempt' THEN 1 END) as blocked_attempts,
                MIN(scanned_at) as first_scan_time,
                MAX(scanned_at) as last_scan_time
            FROM scans 
            WHERE scan_date = $1::date
        `, [targetDate]);

        const hourlyStats = await query(`
            SELECT 
                EXTRACT(HOUR FROM scanned_at) as hour,
                COUNT(*) as scan_count,
                COUNT(DISTINCT visitor_id) as unique_visitors
            FROM scans 
            WHERE scan_date = $1::date
            GROUP BY EXTRACT(HOUR FROM scanned_at)
            ORDER BY hour
        `, [targetDate]);

        res.json({
            date: targetDate.toISOString().split('T')[0],
            summary: stats.rows[0],
            hourly: hourlyStats.rows.map(row => ({
                hour: parseInt(row.hour),
                scanCount: parseInt(row.scan_count),
                uniqueVisitors: parseInt(row.unique_visitors)
            })),
            timestamp: new Date().toISOString()
        });

    } catch (err) {
        console.error('Ошибка получения статистики сканирований:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Поиск сканирований
router.get('/search/scans', requireScanAuth, async (req, res) => {
    try {
        const {
            visitor_name,
            scan_type,
            date_from,
            date_to,
            page = 1,
            limit = 50
        } = req.query;

        const offset = (page - 1) * limit;
        const conditions = [];
        const params = [];

        let query_text = `
            SELECT 
                s.id, s.scan_type, s.scanned_at, s.ip_address,
                v.visitor_uuid, v.last_name, v.first_name, v.middle_name, v.status,
                u.username as scanned_by_username
            FROM scans s
            JOIN visitors v ON s.visitor_id = v.id
            LEFT JOIN users u ON s.scanned_by = u.id
        `;

        if (visitor_name) {
            conditions.push(`(
                v.last_name ILIKE ${params.length + 1} OR 
                v.first_name ILIKE ${params.length + 1} OR 
                v.middle_name ILIKE ${params.length + 1}
            )`);
            params.push(`%${visitor_name}%`);
        }

        if (scan_type && ['first', 'repeat', 'duplicate', 'blocked_attempt', 'batch'].includes(scan_type)) {
            conditions.push(`s.scan_type = ${params.length + 1}`);
            params.push(scan_type);
        }

        if (date_from) {
            conditions.push(`s.scan_date >= ${params.length + 1}`);
            params.push(date_from);
        }

        if (date_to) {
            conditions.push(`s.scan_date <= ${params.length + 1}`);
            params.push(date_to);
        }

        if (conditions.length > 0) {
            query_text += ' WHERE ' + conditions.join(' AND ');
        }

        query_text += `
            ORDER BY s.scanned_at DESC
            LIMIT ${params.length + 1} OFFSET ${params.length + 2}
        `;

        params.push(limit, offset);

        const result = await query(query_text, params);

        // Получаем общее количество
        let count_query = `
            SELECT COUNT(*) as total
            FROM scans s
            JOIN visitors v ON s.visitor_id = v.id
        `;

        if (conditions.length > 0) {
            count_query += ' WHERE ' + conditions.join(' AND ');
        }

        const countResult = await query(count_query, params.slice(0, -2));
        const total = parseInt(countResult.rows[0].total);

        res.json({
            scans: result.rows.map(scan => ({
                id: scan.id,
                scanType: scan.scan_type,
                scannedAt: scan.scanned_at,
                ipAddress: scan.ip_address,
                visitor: {
                    uuid: scan.visitor_uuid,
                    name: `${scan.last_name} ${scan.first_name} ${scan.middle_name || ''}`.trim(),
                    status: scan.status
                },
                scannedByUsername: scan.scanned_by_username
            })),
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: total,
                pages: Math.ceil(total / limit)
            },
            timestamp: new Date().toISOString()
        });

    } catch (err) {
        console.error('Ошибка поиска сканирований:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

module.exports = router;