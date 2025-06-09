// routes/debug.js - Маршруты для отладки (только в development)
const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { query } = require('../config/database');

const router = express.Router();

// Middleware для проверки что отладка включена
const requireDebugMode = (req, res, next) => {
    const isDebugEnabled = process.env.NODE_ENV === 'development' ||
        process.env.DEBUG_MODE === 'true' ||
        req.user?.role === 'admin';

    if (!isDebugEnabled) {
        return res.status(404).json({ error: 'Не найдено' });
    }

    next();
};

// Конфигурация отладки для фронтенда
router.get('/config', requireAuth, requireDebugMode, (req, res) => {
    const debugConfig = {
        enabled: true,
        logLevel: process.env.DEBUG_LOG_LEVEL || 'info',
        showInConsole: true,
        showInUI: req.user.role === 'admin' || process.env.NODE_ENV === 'development',
        userRole: req.user.role,
        environment: process.env.NODE_ENV,
        features: {
            apiTesting: true,
            performanceMonitoring: req.user.role === 'admin',
            databaseQueries: req.user.role === 'admin' && process.env.NODE_ENV === 'development',
            errorReporting: true
        }
    };

    res.json(debugConfig);
});

// Тестовые данные
router.post('/test-data', requireAuth, requireRole(['admin']), requireDebugMode, async (req, res) => {
    try {
        const { type } = req.body;

        switch (type) {
            case 'events':
                // Создаем тестовые события
                const testEvents = [
                    {
                        name: 'Тестовое событие 1',
                        description: 'Создано для тестирования',
                        start_date: new Date().toISOString().split('T')[0],
                        end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                        location: 'Тестовая локация',
                        status: 'active'
                    },
                    {
                        name: 'Тестовое событие 2',
                        description: 'Второе тестовое событие',
                        start_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                        end_date: new Date(Date.now() + 37 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                        location: 'Другая локация',
                        status: 'active'
                    }
                ];

                let createdCount = 0;
                for (const eventData of testEvents) {
                    try {
                        await query(`
                            INSERT INTO events (name, description, start_date, end_date, location, status, created_by)
                            VALUES ($1, $2, $3, $4, $5, $6, $7)
                        `, [
                            eventData.name,
                            eventData.description,
                            eventData.start_date,
                            eventData.end_date,
                            eventData.location,
                            eventData.status,
                            req.user.id
                        ]);
                        createdCount++;
                    } catch (err) {
                        console.log(`Событие "${eventData.name}" уже существует или ошибка создания`);
                    }
                }

                res.json({
                    success: true,
                    message: `Создано ${createdCount} тестовых событий`,
                    created: createdCount
                });
                break;

            default:
                res.status(400).json({ error: 'Неизвестный тип тестовых данных' });
        }
    } catch (err) {
        console.error('Ошибка создания тестовых данных:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Информация о системе для отладки
router.get('/system-info', requireAuth, requireDebugMode, (req, res) => {
    const systemInfo = {
        node_version: process.version,
        platform: process.platform,
        arch: process.arch,
        uptime: process.uptime(),
        memory_usage: process.memoryUsage(),
        environment: process.env.NODE_ENV,
        debug_mode: process.env.DEBUG_MODE,
        user: {
            id: req.user.id,
            username: req.user.username,
            role: req.user.role
        },
        session: {
            id: req.sessionID,
            max_age: req.session.cookie.maxAge
        },
        timestamp: new Date().toISOString()
    };

    res.json(systemInfo);
});

// Выполнение SQL запросов (только для админов в development)
router.post('/query', requireAuth, requireRole(['admin']), requireDebugMode, async (req, res) => {
    try {
        if (process.env.NODE_ENV !== 'development') {
            return res.status(403).json({ error: 'Доступно только в режиме разработки' });
        }

        const { sql, params = [] } = req.body;

        if (!sql || typeof sql !== 'string') {
            return res.status(400).json({ error: 'SQL запрос обязателен' });
        }

        // Разрешаем только SELECT запросы для безопасности
        if (!sql.trim().toLowerCase().startsWith('select')) {
            return res.status(403).json({ error: 'Разрешены только SELECT запросы' });
        }

        const result = await query(sql, params);

        res.json({
            success: true,
            rows: result.rows,
            rowCount: result.rowCount,
            command: result.command,
            executedAt: new Date().toISOString()
        });

    } catch (err) {
        console.error('Ошибка выполнения debug запроса:', err);
        res.status(500).json({
            error: 'Ошибка выполнения запроса',
            details: err.message
        });
    }
});

// Очистка кэша и перезагрузка данных
router.post('/reload', requireAuth, requireDebugMode, (req, res) => {
    try {
        // Здесь можно добавить логику очистки кэша
        // Например, очистка сессий, временных файлов и т.д.

        res.json({
            success: true,
            message: 'Данные перезагружены',
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        console.error('Ошибка перезагрузки:', err);
        res.status(500).json({ error: 'Ошибка перезагрузки' });
    }
});

// Экспорт только в development режиме
if (process.env.NODE_ENV === 'development' || process.env.DEBUG_MODE === 'true') {
    module.exports = router;
} else {
    // В production возвращаем пустой роутер
    module.exports = express.Router();
}