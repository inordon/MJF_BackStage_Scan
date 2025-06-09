const express = require('express');
const { query } = require('../config/database');
const { requireScanAuth } = require('../middleware/auth');

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

// Детальная статистика сканирований (упрощенная версия)
router.get('/stats/detailed', requireScanAuth, async (req, res) => {
    try {
        const {
            date_from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            date_to = new Date().toISOString().split('T')[0]
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
            timestamp: new Date().toISOString()
        });

    } catch (err) {
        console.error('Ошибка получения детальной статистики сканирований:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Получить статистику топ-активности (упрощенная)
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
                MAX(s.scanned_at) as last_scan
            FROM visitors v
                     LEFT JOIN events e ON v.event_id = e.id
                     LEFT JOIN scans s ON v.id = s.visitor_id
            WHERE s.scan_date >= CURRENT_DATE - INTERVAL '${parseInt(period)} days'
            GROUP BY v.id, v.last_name, v.first_name, v.middle_name, e.name
            ORDER BY scan_count DESC
                LIMIT $1
        `, [limit]);

        res.json({
            period: `${period} дней`,
            topVisitors: topVisitors.rows.map(row => ({
                id: row.id,
                name: `${row.last_name} ${row.first_name} ${row.middle_name || ''}`.trim(),
                eventName: row.event_name,
                scanCount: parseInt(row.scan_count),
                lastScan: row.last_scan
            })),
            timestamp: new Date().toISOString()
        });

    } catch (err) {
        console.error('Ошибка получения топ-активности:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

module.exports = router;