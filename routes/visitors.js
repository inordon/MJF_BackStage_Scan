// routes/visitors.js - Оптимизированная версия

const express = require('express');
const { getVisitorsWithStats, getVisitorCount } = require('../services/visitorService');
const { validatePagination, validateFilters } = require('../utils/validators');
const { cacheMiddleware } = require('../middleware/cache');

const router = express.Router();

// Оптимизированный эндпоинт для получения посетителей
router.get('/',
    requireAuth,
    validatePagination,
    validateFilters,
    cacheMiddleware({ ttl: 60, key: 'visitors' }),
    async (req, res) => {
        try {
            const { page = 1, limit = 50, status, search, event_id } = req.query;
            const offset = (page - 1) * limit;

            // Валидация параметров
            const filters = {
                status: status && ['active', 'blocked'].includes(status) ? status : null,
                search: search ? search.trim() : null,
                event_id: event_id ? parseInt(event_id) : null
            };

            // Параллельное выполнение запросов
            const [visitorsResult, totalCount] = await Promise.all([
                getVisitorsWithStats(filters, limit, offset),
                getVisitorCount(filters)
            ]);

            const response = {
                visitors: visitorsResult.map(formatVisitorResponse),
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: totalCount,
                    pages: Math.ceil(totalCount / limit),
                    hasNext: page * limit < totalCount,
                    hasPrev: page > 1
                },
                filters: filters,
                timestamp: new Date().toISOString()
            };

            // Устанавливаем заголовки кэширования
            res.set({
                'Cache-Control': 'public, max-age=60',
                'ETag': generateETag(response)
            });

            res.json(response);

        } catch (err) {
            console.error('Error fetching visitors:', err);
            res.status(500).json({
                error: 'Failed to fetch visitors',
                code: 'VISITORS_FETCH_ERROR',
                details: process.env.NODE_ENV === 'development' ? err.message : undefined
            });
        }
    }
);

// Оптимизированный сервис для работы с посетителями
// services/visitorService.js
const { query } = require('../config/database');

async function getVisitorsWithStats(filters, limit, offset) {
    const conditions = [];
    const params = [];

    let baseQuery = `
        SELECT 
            v.id, v.visitor_uuid, v.last_name, v.first_name, v.middle_name,
            v.comment, v.status, v.created_at, v.updated_at,
            v.photo_path, v.qr_code_path, v.event_id,
            
            creator.full_name as created_by_name,
            e.name as event_name, 
            e.start_date as event_start_date, 
            e.end_date as event_end_date,
            
            -- Агрегированная статистика сканирований
            COALESCE(scan_stats.total_scans, 0) as total_scans,
            COALESCE(scan_stats.today_scans, 0) as today_scans,
            COALESCE(scan_stats.first_scans, 0) as first_scans,
            COALESCE(scan_stats.repeat_scans, 0) as repeat_scans,
            scan_stats.last_scan_time
            
        FROM visitors v
        LEFT JOIN users creator ON v.created_by = creator.id
        LEFT JOIN events e ON v.event_id = e.id
        LEFT JOIN LATERAL (
            SELECT 
                COUNT(*) as total_scans,
                COUNT(CASE WHEN scan_date = CURRENT_DATE THEN 1 END) as today_scans,
                COUNT(CASE WHEN scan_type = 'first' THEN 1 END) as first_scans,
                COUNT(CASE WHEN scan_type = 'repeat' THEN 1 END) as repeat_scans,
                MAX(scanned_at) as last_scan_time
            FROM scans s 
            WHERE s.visitor_id = v.id
        ) scan_stats ON true
    `;

    // Построение условий фильтрации
    if (filters.status) {
        conditions.push(`v.status = $${params.length + 1}`);
        params.push(filters.status);
    }

    if (filters.event_id) {
        conditions.push(`v.event_id = $${params.length + 1}`);
        params.push(filters.event_id);
    }

    if (filters.search) {
        conditions.push(`(
            v.last_name ILIKE $${params.length + 1} OR 
            v.first_name ILIKE $${params.length + 1} OR 
            v.middle_name ILIKE $${params.length + 1} OR
            v.comment ILIKE $${params.length + 1} OR
            e.name ILIKE $${params.length + 1}
        )`);
        params.push(`%${filters.search}%`);
    }

    if (conditions.length > 0) {
        baseQuery += ' WHERE ' + conditions.join(' AND ');
    }

    baseQuery += `
        ORDER BY v.created_at DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;

    params.push(limit, offset);

    const result = await query(baseQuery, params, {
        name: 'get_visitors_with_stats',
        useCache: true,
        cacheTTL: 60
    });

    return result.rows;
}

async function getVisitorCount(filters) {
    const conditions = [];
    const params = [];

    let countQuery = `
        SELECT COUNT(DISTINCT v.id) as total 
        FROM visitors v 
        LEFT JOIN events e ON v.event_id = e.id
    `;

    // Те же условия что и в основном запросе
    if (filters.status) {
        conditions.push(`v.status = $${params.length + 1}`);
        params.push(filters.status);
    }

    if (filters.event_id) {
        conditions.push(`v.event_id = $${params.length + 1}`);
        params.push(filters.event_id);
    }

    if (filters.search) {
        conditions.push(`(
            v.last_name ILIKE $${params.length + 1} OR 
            v.first_name ILIKE $${params.length + 1} OR 
            v.middle_name ILIKE $${params.length + 1} OR
            v.comment ILIKE $${params.length + 1} OR
            e.name ILIKE $${params.length + 1}
        )`);
        params.push(`%${filters.search}%`);
    }

    if (conditions.length > 0) {
        countQuery += ' WHERE ' + conditions.join(' AND ');
    }

    const result = await query(countQuery, params, {
        name: 'get_visitor_count',
        useCache: true,
        cacheTTL: 120
    });

    return parseInt(result.rows[0].total);
}

function formatVisitorResponse(visitor) {
    return {
        id: visitor.id,
        visitor_uuid: visitor.visitor_uuid,
        name: {
            last: visitor.last_name,
            first: visitor.first_name,
            middle: visitor.middle_name,
            full: `${visitor.last_name} ${visitor.first_name} ${visitor.middle_name || ''}`.trim()
        },
        comment: visitor.comment,
        status: visitor.status,
        timestamps: {
            created_at: visitor.created_at,
            updated_at: visitor.updated_at
        },
        files: {
            photo_path: visitor.photo_path,
            qr_code_path: visitor.qr_code_path
        },
        event: visitor.event_id ? {
            id: visitor.event_id,
            name: visitor.event_name,
            start_date: visitor.event_start_date,
            end_date: visitor.event_end_date
        } : null,
        created_by_name: visitor.created_by_name,
        stats: {
            total_scans: parseInt(visitor.total_scans || 0),
            today_scans: parseInt(visitor.today_scans || 0),
            first_scans: parseInt(visitor.first_scans || 0),
            repeat_scans: parseInt(visitor.repeat_scans || 0),
            last_scan_time: visitor.last_scan_time,
            has_scanned_today: parseInt(visitor.today_scans || 0) > 0
        }
    };
}

function generateETag(data) {
    const crypto = require('crypto');
    return crypto.createHash('md5').update(JSON.stringify(data)).digest('hex');
}

module.exports = {
    getVisitorsWithStats,
    getVisitorCount,
    formatVisitorResponse
};