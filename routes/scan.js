const express = require('express');
const { query } = require('../config/database');
const { requireScanAuth, canExportScanStatistics, checkExportLimits, logExportAction } = require('../middleware/auth');

const router = express.Router();

// Сканирование штрихкода посетителя
router.get('/:barcode', requireScanAuth, async (req, res) => {
    try {
        const { barcode } = req.params;
        const userId = req.user.id;

        console.log('Сканирование штрихкода:', barcode);

        // Получаем данные посетителя по штрихкоду
        const visitorResult = await query(
            'SELECT id, last_name, first_name, middle_name, comment, status FROM visitors WHERE barcode = $1',
            [barcode]
        );

        // Если посетитель не найден
        if (!visitorResult.rows.length) {
            console.log('Посетитель с штрихкодом не найден:', barcode);
            return res.json({
                status: 'error',
                type: 'not_found',
                icon: '❌',
                title: 'ПРОХОД ЗАПРЕЩЕН',
                message: 'Штрихкод не найден в базе данных',
                barcode: barcode,
                timestamp: new Date().toISOString()
            });
        }

        const visitor = visitorResult.rows[0];
        console.log('Найден посетитель:', visitor);

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
                barcode: barcode,
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
                barcode: barcode,
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
                barcode: barcode,
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
                barcode: barcode,
                message: 'Дублирующее сканирование (менее 30 минут назад)',
                scanCount: todayScansResult.rows.length + 1,
                timestamp: new Date().toISOString()
            });
        }

    } catch (err) {
        console.error('Ошибка сканирования штрихкода:', err);

        res.json({
            status: 'error',
            type: 'system_error',
            icon: 'ℹ️',
            title: 'Обратитесь к организатору',
            message: 'Произошла техническая ошибка при сканировании',
            barcode: req.params.barcode,
            error: process.env.NODE_ENV === 'development' ? err.message : undefined,
            timestamp: new Date().toISOString()
        });
    }
});

// Массовое сканирование (для тестирования)
router.post('/batch', requireScanAuth, async (req, res) => {
    try {
        const { barcodes } = req.body;

        if (!Array.isArray(barcodes) || barcodes.length === 0) {
            return res.status(400).json({ error: 'Требуется массив штрихкодов посетителей' });
        }

        if (barcodes.length > 10) {
            return res.status(400).json({ error: 'Максимум 10 штрихкодов за раз' });
        }

        const results = [];

        for (const barcode of barcodes) {
            try {
                // Используем тот же алгоритм, что и для одиночного сканирования
                const visitorResult = await query(
                    'SELECT id, last_name, first_name, middle_name, comment, status FROM visitors WHERE barcode = $1',
                    [barcode]
                );

                if (!visitorResult.rows.length) {
                    results.push({
                        barcode,
                        status: 'error',
                        message: 'Посетитель не найден'
                    });
                    continue;
                }

                const visitor = visitorResult.rows[0];

                if (visitor.status === 'blocked') {
                    results.push({
                        barcode,
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
                    barcode,
                    status: 'success',
                    message: 'Сканирование успешно',
                    name: `${visitor.last_name} ${visitor.first_name} ${visitor.middle_name || ''}`.trim(),
                    scanTime: scanResult.rows[0].scanned_at
                });

            } catch (err) {
                console.error(`Ошибка сканирования штрихкода ${barcode}:`, err);
                results.push({
                    barcode,
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
            barcode,
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
                v.barcode, v.last_name, v.first_name, v.middle_name, v.status,
                u.username as scanned_by_username
            FROM scans s
                     JOIN visitors v ON s.visitor_id = v.id
                     LEFT JOIN users u ON s.scanned_by = u.id
        `;

        if (visitor_name) {
            conditions.push(`(
                v.last_name ILIKE $${params.length + 1} OR 
                v.first_name ILIKE $${params.length + 1} OR 
                v.middle_name ILIKE $${params.length + 1}
            )`);
            params.push(`%${visitor_name}%`);
        }

        if (barcode) {
            conditions.push(`v.barcode ILIKE $${params.length + 1}`);
            params.push(`%${barcode}%`);
        }

        if (scan_type && ['first', 'repeat', 'duplicate', 'blocked_attempt', 'batch'].includes(scan_type)) {
            conditions.push(`s.scan_type = $${params.length + 1}`);
            params.push(scan_type);
        }

        if (date_from) {
            conditions.push(`s.scan_date >= $${params.length + 1}`);
            params.push(date_from);
        }

        if (date_to) {
            conditions.push(`s.scan_date <= $${params.length + 1}`);
            params.push(date_to);
        }

        if (conditions.length > 0) {
            query_text += ' WHERE ' + conditions.join(' AND ');
        }

        query_text += `
            ORDER BY s.scanned_at DESC
            LIMIT $${params.length + 1} OFFSET $${params.length + 2}
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
                    barcode: scan.barcode,
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

// Детальная статистика сканирований
router.get('/stats/detailed', requireScanAuth, async (req, res) => {
    try {
        const {
            date_from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 30 дней назад
            date_to = new Date().toISOString().split('T')[0] // сегодня
        } = req.query;

        // Основная статистика
        const mainStats = await query(`
            SELECT
                COUNT(*) as total_scans,
                COUNT(DISTINCT visitor_id) as unique_visitors,
                COUNT(CASE WHEN scan_type = 'first' THEN 1 END) as first_scans,
                COUNT(CASE WHEN scan_type = 'repeat' THEN 1 END) as repeat_scans,
                COUNT(CASE WHEN scan_type = 'duplicate' THEN 1 END) as duplicate_scans,
                COUNT(CASE WHEN scan_type = 'blocked_attempt' THEN 1 END) as blocked_attempts,
                COUNT(CASE WHEN scan_type = 'batch' THEN 1 END) as batch_scans,
                MIN(scanned_at) as first_scan_time,
                MAX(scanned_at) as last_scan_time
            FROM scans
            WHERE scan_date BETWEEN $1 AND $2
        `, [date_from, date_to]);

        // Статистика по дням
        const dailyStats = await query(`
            SELECT
                scan_date,
                COUNT(*) as scan_count,
                COUNT(DISTINCT visitor_id) as unique_visitors,
                COUNT(CASE WHEN scan_type = 'first' THEN 1 END) as first_scans,
                COUNT(CASE WHEN scan_type = 'repeat' THEN 1 END) as repeat_scans
            FROM scans
            WHERE scan_date BETWEEN $1 AND $2
            GROUP BY scan_date
            ORDER BY scan_date
        `, [date_from, date_to]);

        // Статистика по часам (за сегодня)
        const hourlyStats = await query(`
            SELECT
                EXTRACT(HOUR FROM scanned_at) as hour,
                COUNT(*) as scan_count,
                COUNT(DISTINCT visitor_id) as unique_visitors
            FROM scans
            WHERE scan_date = CURRENT_DATE
            GROUP BY EXTRACT(HOUR FROM scanned_at)
            ORDER BY hour
        `);

        // Статистика по событиям
        const eventStats = await query(`
            SELECT
                e.id,
                e.name,
                COUNT(s.id) as scan_count,
                COUNT(DISTINCT s.visitor_id) as unique_visitors
            FROM events e
                     LEFT JOIN visitors v ON e.id = v.event_id
                     LEFT JOIN scans s ON v.id = s.visitor_id AND s.scan_date BETWEEN $1 AND $2
            GROUP BY e.id, e.name
            HAVING COUNT(s.id) > 0
            ORDER BY scan_count DESC
        `, [date_from, date_to]);

        res.json({
            period: { date_from, date_to },
            summary: mainStats.rows[0],
            daily: dailyStats.rows.map(row => ({
                date: row.scan_date,
                scanCount: parseInt(row.scan_count),
                uniqueVisitors: parseInt(row.unique_visitors),
                firstScans: parseInt(row.first_scans || 0),
                repeatScans: parseInt(row.repeat_scans || 0)
            })),
            hourly: hourlyStats.rows.map(row => ({
                hour: parseInt(row.hour),
                scanCount: parseInt(row.scan_count),
                uniqueVisitors: parseInt(row.unique_visitors)
            })),
            events: eventStats.rows.map(row => ({
                id: row.id,
                name: row.name,
                scanCount: parseInt(row.scan_count),
                uniqueVisitors: parseInt(row.unique_visitors)
            })),
            timestamp: new Date().toISOString()
        });

    } catch (err) {
        console.error('Ошибка получения детальной статистики сканирований:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Получить статистику топ-активности
router.get('/stats/top-activity', requireScanAuth, async (req, res) => {
    try {
        const { limit = 10, period = '7' } = req.query;

        // Топ посетителей по количеству сканирований
        const topVisitors = await query(`
            SELECT
                v.id,
                v.last_name,
                v.first_name,
                v.middle_name,
                e.name as event_name,
                COUNT(s.id) as scan_count,
                COUNT(DISTINCT s.scan_date) as active_days,
                MAX(s.scanned_at) as last_scan
            FROM visitors v
                     LEFT JOIN events e ON v.event_id = e.id
                     LEFT JOIN scans s ON v.id = s.visitor_id
            WHERE s.scan_date >= CURRENT_DATE - INTERVAL '${parseInt(period)} days'
            GROUP BY v.id, v.last_name, v.first_name, v.middle_name, e.name
            ORDER BY scan_count DESC
                LIMIT $1
        `, [limit]);

        // Топ часов по активности
        const topHours = await query(`
            SELECT
                EXTRACT(HOUR FROM scanned_at) as hour,
                COUNT(*) as scan_count,
                COUNT(DISTINCT visitor_id) as unique_visitors,
                COUNT(DISTINCT scan_date) as active_days
            FROM scans
            WHERE scan_date >= CURRENT_DATE - INTERVAL '${parseInt(period)} days'
            GROUP BY EXTRACT(HOUR FROM scanned_at)
            ORDER BY scan_count DESC
                LIMIT $1
        `, [limit]);

        // Топ дней по активности
        const topDays = await query(`
            SELECT
                scan_date,
                COUNT(*) as scan_count,
                COUNT(DISTINCT visitor_id) as unique_visitors,
                COUNT(CASE WHEN scan_type = 'first' THEN 1 END) as first_time_visitors
            FROM scans
            WHERE scan_date >= CURRENT_DATE - INTERVAL '${parseInt(period)} days'
            GROUP BY scan_date
            ORDER BY scan_count DESC
                LIMIT $1
        `);

        res.json({
            period: `${period} дней`,
            topVisitors: topVisitors.rows.map(row => ({
                id: row.id,
                name: `${row.last_name} ${row.first_name} ${row.middle_name || ''}`.trim(),
                eventName: row.event_name,
                scanCount: parseInt(row.scan_count),
                activeDays: parseInt(row.active_days),
                lastScan: row.last_scan
            })),
            topHours: topHours.rows.map(row => ({
                hour: parseInt(row.hour),
                scanCount: parseInt(row.scan_count),
                uniqueVisitors: parseInt(row.unique_visitors),
                activeDays: parseInt(row.active_days)
            })),
            topDays: topDays.rows.map(row => ({
                date: row.scan_date,
                scanCount: parseInt(row.scan_count),
                uniqueVisitors: parseInt(row.unique_visitors),
                firstTimeVisitors: parseInt(row.first_time_visitors || 0)
            })),
            timestamp: new Date().toISOString()
        });

    } catch (err) {
        console.error('Ошибка получения топ-активности:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Получить сравнительную статистику
router.get('/stats/comparison', requireScanAuth, async (req, res) => {
    try {
        // Сравнение текущей недели с предыдущей
        const currentWeekStats = await query(`
            SELECT
                COUNT(*) as total_scans,
                COUNT(DISTINCT visitor_id) as unique_visitors,
                COUNT(CASE WHEN scan_type = 'first' THEN 1 END) as first_scans
            FROM scans
            WHERE scan_date >= CURRENT_DATE - INTERVAL '7 days'
        `);

        const previousWeekStats = await query(`
            SELECT
                COUNT(*) as total_scans,
                COUNT(DISTINCT visitor_id) as unique_visitors,
                COUNT(CASE WHEN scan_type = 'first' THEN 1 END) as first_scans
            FROM scans
            WHERE scan_date >= CURRENT_DATE - INTERVAL '14 days'
              AND scan_date < CURRENT_DATE - INTERVAL '7 days'
        `);

        // Сравнение сегодня с вчера
        const todayStats = await query(`
            SELECT
                COUNT(*) as total_scans,
                COUNT(DISTINCT visitor_id) as unique_visitors
            FROM scans
            WHERE scan_date = CURRENT_DATE
        `);

        const yesterdayStats = await query(`
            SELECT
                COUNT(*) as total_scans,
                COUNT(DISTINCT visitor_id) as unique_visitors
            FROM scans
            WHERE scan_date = CURRENT_DATE - INTERVAL '1 day'
        `);

        // Вычисляем изменения
        const calculateChange = (current, previous) => {
            if (previous === 0) return current > 0 ? 100 : 0;
            return Math.round(((current - previous) / previous) * 100);
        };

        const currentWeek = currentWeekStats.rows[0];
        const previousWeek = previousWeekStats.rows[0];
        const today = todayStats.rows[0];
        const yesterday = yesterdayStats.rows[0];

        res.json({
            weeklyComparison: {
                current: {
                    totalScans: parseInt(currentWeek.total_scans),
                    uniqueVisitors: parseInt(currentWeek.unique_visitors),
                    firstScans: parseInt(currentWeek.first_scans)
                },
                previous: {
                    totalScans: parseInt(previousWeek.total_scans),
                    uniqueVisitors: parseInt(previousWeek.unique_visitors),
                    firstScans: parseInt(previousWeek.first_scans)
                },
                changes: {
                    totalScans: calculateChange(
                        parseInt(currentWeek.total_scans),
                        parseInt(previousWeek.total_scans)
                    ),
                    uniqueVisitors: calculateChange(
                        parseInt(currentWeek.unique_visitors),
                        parseInt(previousWeek.unique_visitors)
                    ),
                    firstScans: calculateChange(
                        parseInt(currentWeek.first_scans),
                        parseInt(previousWeek.first_scans)
                    )
                }
            },
            dailyComparison: {
                today: {
                    totalScans: parseInt(today.total_scans),
                    uniqueVisitors: parseInt(today.unique_visitors)
                },
                yesterday: {
                    totalScans: parseInt(yesterday.total_scans),
                    uniqueVisitors: parseInt(yesterday.unique_visitors)
                },
                changes: {
                    totalScans: calculateChange(
                        parseInt(today.total_scans),
                        parseInt(yesterday.total_scans)
                    ),
                    uniqueVisitors: calculateChange(
                        parseInt(today.unique_visitors),
                        parseInt(yesterday.unique_visitors)
                    )
                }
            },
            timestamp: new Date().toISOString()
        });

    } catch (err) {
        console.error('Ошибка получения сравнительной статистики:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Экспорт статистики сканирований с проверкой прав
router.get('/export/statistics',
    requireScanAuth,
    canExportScanStatistics,
    checkExportLimits,
    logExportAction('scan_statistics'),
    async (req, res) => {
        try {
            const {
                format = 'csv',
                event_id,
                status,
                date_from,
                date_to = new Date().toISOString().split('T')[0],
                include_no_scans = 'false'
            } = req.query;

            console.log('📊 Запрос экспорта статистики сканирований:', {
                format, event_id, status, date_from, date_to, include_no_scans,
                user: req.user.username,
                role: req.user.role
            });

            // Определяем период по умолчанию в зависимости от роли
            const defaultDaysBack = {
                admin: 90,
                moderator: 30,
                skd: 7
            }[req.user.role] || 7;

            const defaultDateFrom = new Date();
            defaultDateFrom.setDate(defaultDateFrom.getDate() - defaultDaysBack);
            const actualDateFrom = date_from || defaultDateFrom.toISOString().split('T')[0];

            // Проверяем права на просмотр персональных данных
            const canViewPersonalData = req.exportPermissions.canViewPersonalData;
            const maxRows = req.exportPermissions.maxExportRows;

            // Основной запрос для получения статистики посетителей
            let queryText = `
            SELECT 
                v.id,
                ${canViewPersonalData ? `
                    v.last_name,
                    v.first_name,
                    v.middle_name,
                    v.comment,
                ` : `
                    '***' as last_name,
                    '***' as first_name,
                    '' as middle_name,
                    'Скрыто' as comment,
                `}
                v.barcode,
                v.status,
                v.created_at,
                e.name as event_name,
                e.location as event_location,
                COUNT(s.id) as total_scans,
                MIN(s.scanned_at) as first_scan_time,
                MAX(s.scanned_at) as last_scan_time,
                COUNT(CASE WHEN s.scan_type = 'first' THEN 1 END) as first_scans,
                COUNT(CASE WHEN s.scan_type = 'repeat' THEN 1 END) as repeat_scans,
                COUNT(CASE WHEN s.scan_type = 'duplicate' THEN 1 END) as duplicate_scans,
                COUNT(CASE WHEN s.scan_date = CURRENT_DATE THEN 1 END) as today_scans,
                STRING_AGG(DISTINCT TO_CHAR(s.scan_date, 'DD.MM.YYYY'), ', ' ORDER BY TO_CHAR(s.scan_date, 'DD.MM.YYYY')) as scan_dates
            FROM visitors v
            LEFT JOIN events e ON v.event_id = e.id
            LEFT JOIN scans s ON v.id = s.visitor_id 
                AND s.scan_date BETWEEN $1::date AND $2::date
        `;

            const queryParams = [actualDateFrom, date_to];
            const conditions = [];

            // Фильтр по событию (если пользователь может видеть все события)
            if (event_id && !isNaN(parseInt(event_id))) {
                if (req.exportPermissions.canViewAllEvents || req.user.role === 'admin') {
                    conditions.push(`v.event_id = $${queryParams.length + 1}`);
                    queryParams.push(parseInt(event_id));
                }
            }

            // Фильтр по статусу посетителя
            if (status && ['active', 'blocked'].includes(status)) {
                conditions.push(`v.status = $${queryParams.length + 1}`);
                queryParams.push(status);
            }

            // Фильтр: включать ли посетителей без сканирований
            if (include_no_scans !== 'true') {
                conditions.push(`EXISTS (
                SELECT 1 FROM scans s2 
                WHERE s2.visitor_id = v.id 
                AND s2.scan_date BETWEEN $1::date AND $2::date
            )`);
            }

            if (conditions.length > 0) {
                queryText += ' WHERE ' + conditions.join(' AND ');
            }

            queryText += `
            GROUP BY v.id, v.last_name, v.first_name, v.middle_name, v.barcode, 
                     v.comment, v.status, v.created_at, e.name, e.location
            ORDER BY total_scans DESC, v.last_name, v.first_name
        `;

            // Добавляем лимит если установлен
            if (maxRows) {
                queryText += ` LIMIT ${maxRows}`;
            }

            console.log('📋 SQL запрос:', queryText);
            console.log('📋 Параметры:', queryParams);

            const result = await query(queryText, queryParams);
            const data = result.rows;

            console.log(`📊 Найдено записей для экспорта: ${data.length} (пользователь: ${req.user.username})`);

            if (data.length === 0) {
                return res.status(404).json({
                    error: 'Нет данных для экспорта в указанном периоде',
                    period: { date_from: actualDateFrom, date_to },
                    filters: { event_id, status, include_no_scans },
                    user_role: req.user.role
                });
            }

            // Формируем имя файла
            const dateRange = `${actualDateFrom.replace(/-/g, '')}_${date_to.replace(/-/g, '')}`;
            const eventSuffix = event_id ? `_event${event_id}` : '';
            const userSuffix = req.user.role === 'admin' ? '' : `_${req.user.role}`;
            const filename = `scan_statistics_${dateRange}${eventSuffix}${userSuffix}`;

            if (format === 'csv') {
                // CSV экспорт
                const headers = [
                    'ID',
                    'Фамилия',
                    'Имя',
                    'Отчество',
                    'Штрихкод',
                    'Комментарий',
                    'Статус',
                    'Событие',
                    'Локация события',
                    'Дата регистрации',
                    'Общее количество сканирований',
                    'Время первого сканирования',
                    'Время последнего сканирования',
                    'Первичных сканирований',
                    'Повторных сканирований',
                    'Дублирующих сканирований',
                    'Сканирований сегодня',
                    'Даты сканирований'
                ];

                const csvRows = data.map(row => [
                    row.id,
                    `"${row.last_name || ''}"`,
                    `"${row.first_name || ''}"`,
                    `"${row.middle_name || ''}"`,
                    `"${row.barcode || ''}"`,
                    `"${(row.comment || '').replace(/"/g, '""')}"`,
                    row.status === 'active' ? 'Активен' : 'Заблокирован',
                    `"${row.event_name || 'Без события'}"`,
                    `"${row.event_location || ''}"`,
                    row.created_at ? new Date(row.created_at).toLocaleString('ru-RU') : '',
                    parseInt(row.total_scans || 0),
                    row.first_scan_time ? new Date(row.first_scan_time).toLocaleString('ru-RU') : 'Нет сканирований',
                    row.last_scan_time ? new Date(row.last_scan_time).toLocaleString('ru-RU') : 'Нет сканирований',
                    parseInt(row.first_scans || 0),
                    parseInt(row.repeat_scans || 0),
                    parseInt(row.duplicate_scans || 0),
                    parseInt(row.today_scans || 0),
                    `"${row.scan_dates || 'Нет сканирований'}"`
                ]);

                const csvContent = [
                    headers.join(','),
                    ...csvRows.map(row => row.join(','))
                ].join('\n');

                // Добавляем BOM для корректного отображения в Excel
                const csvWithBOM = '\uFEFF' + csvContent;

                res.setHeader('Content-Type', 'text/csv; charset=utf-8');
                res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
                res.send(csvWithBOM);

            } else if (format === 'json') {
                // JSON экспорт
                const jsonData = {
                    export_info: {
                        type: 'scan_statistics',
                        exported_at: new Date().toISOString(),
                        period: {
                            date_from: actualDateFrom,
                            date_to: date_to
                        },
                        filters: {
                            event_id: event_id || null,
                            status: status || null,
                            include_no_scans: include_no_scans === 'true'
                        },
                        total_records: data.length,
                        exported_by: req.user.username,
                        user_role: req.user.role,
                        data_privacy: {
                            personal_data_visible: canViewPersonalData,
                            limited_by_role: !canViewPersonalData
                        }
                    },
                    statistics: data.map(row => ({
                        visitor_info: {
                            id: row.id,
                            full_name: `${row.last_name} ${row.first_name} ${row.middle_name || ''}`.trim(),
                            last_name: row.last_name,
                            first_name: row.first_name,
                            middle_name: row.middle_name,
                            barcode: row.barcode,
                            comment: row.comment,
                            status: row.status,
                            created_at: row.created_at
                        },
                        event_info: {
                            name: row.event_name,
                            location: row.event_location
                        },
                        scan_statistics: {
                            total_scans: parseInt(row.total_scans || 0),
                            first_scan_time: row.first_scan_time,
                            last_scan_time: row.last_scan_time,
                            first_scans: parseInt(row.first_scans || 0),
                            repeat_scans: parseInt(row.repeat_scans || 0),
                            duplicate_scans: parseInt(row.duplicate_scans || 0),
                            today_scans: parseInt(row.today_scans || 0),
                            scan_dates: row.scan_dates ? row.scan_dates.split(', ') : []
                        }
                    }))
                };

                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
                res.json(jsonData);

            } else {
                return res.status(400).json({
                    error: 'Неподдерживаемый формат экспорта',
                    supported_formats: ['csv', 'json']
                });
            }

            console.log(`✅ Экспорт статистики завершен: ${data.length} записей в формате ${format} для пользователя ${req.user.username}`);

            // Логируем успешный экспорт
            if (req.exportLog) {
                req.exportLog.success = true;
                req.exportLog.records_exported = data.length;
                req.exportLog.format = format;
                // Здесь можно добавить сохранение в БД для аудита
            }

        } catch (err) {
            console.error('❌ Ошибка экспорта статистики сканирований:', err);

            // Логируем неудачный экспорт
            if (req.exportLog) {
                req.exportLog.success = false;
                req.exportLog.error = err.message;
            }

            res.status(500).json({
                error: 'Ошибка сервера при экспорте статистики',
                details: process.env.NODE_ENV === 'development' ? err.message : undefined
            });
        }
    });

// Получить краткую статистику для экспорта с учетом прав
router.get('/export/info', requireScanAuth, canExportScanStatistics, async (req, res) => {
    try {
        const { event_id, status } = req.query;
        const canViewAllEvents = req.exportPermissions.canViewAllEvents;

        // Получаем общую информацию о данных с учетом прав
        let statsQuery = `
            SELECT 
                COUNT(DISTINCT v.id) as total_visitors,
                COUNT(s.id) as total_scans,
                MIN(s.scan_date) as first_scan_date,
                MAX(s.scan_date) as last_scan_date,
                COUNT(DISTINCT s.scan_date) as active_days,
                COUNT(DISTINCT v.event_id) as events_count
            FROM visitors v
            LEFT JOIN scans s ON v.id = s.visitor_id
        `;

        const queryParams = [];
        const conditions = [];

        if (event_id && !isNaN(parseInt(event_id)) && canViewAllEvents) {
            conditions.push(`v.event_id = $${queryParams.length + 1}`);
            queryParams.push(parseInt(event_id));
        }

        if (status && ['active', 'blocked'].includes(status)) {
            conditions.push(`v.status = $${queryParams.length + 1}`);
            queryParams.push(status);
        }

        if (conditions.length > 0) {
            statsQuery += ' WHERE ' + conditions.join(' AND ');
        }

        const statsResult = await query(statsQuery, queryParams);

        // Получаем информацию о событиях (с учетом прав)
        let eventsQuery = `
            SELECT e.id, e.name, COUNT(v.id) as visitors_count
            FROM events e
            LEFT JOIN visitors v ON e.id = v.event_id
            GROUP BY e.id, e.name
            ORDER BY visitors_count DESC
        `;

        if (!canViewAllEvents) {
            eventsQuery += ' LIMIT 5'; // Ограничиваем список событий для неадминов
        }

        const eventsResult = await query(eventsQuery);
        const stats = statsResult.rows[0];

        res.json({
            export_info: {
                total_visitors: parseInt(stats.total_visitors || 0),
                total_scans: parseInt(stats.total_scans || 0),
                date_range: {
                    first_scan_date: stats.first_scan_date,
                    last_scan_date: stats.last_scan_date
                },
                active_days: parseInt(stats.active_days || 0),
                events_count: parseInt(stats.events_count || 0)
            },
            available_events: eventsResult.rows.map(event => ({
                id: event.id,
                name: event.name,
                visitors_count: parseInt(event.visitors_count || 0)
            })),
            user_permissions: {
                role: req.user.role,
                can_view_personal_data: req.exportPermissions.canViewPersonalData,
                can_view_all_events: req.exportPermissions.canViewAllEvents,
                max_export_rows: req.exportPermissions.maxExportRows
            },
            supported_formats: ['csv', 'json'],
            timestamp: new Date().toISOString()
        });

    } catch (err) {
        console.error('❌ Ошибка получения информации для экспорта:', err);
        res.status(500).json({
            error: 'Ошибка сервера',
            details: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
});

module.exports = router;