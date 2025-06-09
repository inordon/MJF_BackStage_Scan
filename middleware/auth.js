const { query } = require('../config/database');

// Middleware для проверки авторизации
async function requireAuth(req, res, next) {
    try {
        // Проверяем сессию
        if (!req.session.userId) {
            return res.status(401).json({
                error: 'Требуется авторизация',
                redirectTo: '/login'
            });
        }

        // Получаем информацию о пользователе
        const userResult = await query(
            'SELECT id, username, role, full_name, is_active FROM users WHERE id = $1',
            [req.session.userId]
        );

        if (!userResult.rows.length || !userResult.rows[0].is_active) {
            req.session.destroy();
            return res.status(401).json({
                error: 'Пользователь не найден или заблокирован',
                redirectTo: '/login'
            });
        }

        req.user = userResult.rows[0];
        next();
    } catch (err) {
        console.error('Ошибка проверки авторизации:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
}

// Middleware для проверки роли пользователя
function requireRole(allowedRoles) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Требуется авторизация' });
        }

        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                error: 'Недостаточно прав доступа',
                required: allowedRoles,
                current: req.user.role
            });
        }

        next();
    };
}

// Middleware для проверки авторизации для сканирования
async function requireScanAuth(req, res, next) {
    try {
        if (!req.session.userId) {
            return res.status(401).json({
                error: 'Требуется авторизация для сканирования',
                redirectTo: '/login'
            });
        }

        const userResult = await query(
            'SELECT id, username, role, full_name, is_active FROM users WHERE id = $1',
            [req.session.userId]
        );

        if (!userResult.rows.length || !userResult.rows[0].is_active) {
            req.session.destroy();
            return res.status(401).json({
                error: 'Пользователь не найден или заблокирован',
                redirectTo: '/login'
            });
        }

        const user = userResult.rows[0];

        if (!['admin', 'moderator', 'skd'].includes(user.role)) {
            return res.status(403).json({
                error: 'Недостаточно прав для сканирования'
            });
        }

        req.user = user;
        next();
    } catch (err) {
        console.error('Ошибка проверки авторизации для сканирования:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
}

// Middleware для логирования действий пользователей
function logUserAction(action) {
    return async (req, res, next) => {
        try {
            const logData = {
                userId: req.user?.id,
                action: action,
                ip: req.ip,
                userAgent: req.get('User-Agent'),
                timestamp: new Date(),
                path: req.path,
                method: req.method
            };

            if (process.env.NODE_ENV === 'development') {
                console.log('👤 Действие пользователя:', logData);
            }

            next();
        } catch (err) {
            console.error('Ошибка логирования действия:', err);
            next();
        }
    };
}

// ========== НОВЫЕ ФУНКЦИИ ДЛЯ РЕДАКТИРОВАНИЯ ==========

// Проверка прав на изменение данных посетителя
function canModifyVisitor(req, res, next) {
    const userRole = req.user.role;

    // Администратор и модератор могут изменять данные
    if (['admin', 'moderator'].includes(userRole)) {
        return next();
    }

    return res.status(403).json({
        error: 'Недостаточно прав для изменения данных посетителей',
        required_roles: ['admin', 'moderator'],
        current_role: userRole
    });
}

// Проверка прав на блокировку посетителей
function canBlockVisitor(req, res, next) {
    const userRole = req.user.role;

    if (['admin', 'moderator'].includes(userRole)) {
        return next();
    }

    return res.status(403).json({
        error: 'Недостаточно прав для блокировки посетителей',
        required_roles: ['admin', 'moderator'],
        current_role: userRole
    });
}

// Проверка прав на создание пользователей
function canManageUsers(req, res, next) {
    const userRole = req.user.role;

    if (userRole === 'admin') {
        return next();
    }

    return res.status(403).json({
        error: 'Недостаточно прав для управления пользователями',
        required_roles: ['admin'],
        current_role: userRole
    });
}

// Валидация UUID для посетителей
function validateVisitorUUID(req, res, next) {
    const { uuid } = req.params;

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    if (!uuid || !uuidRegex.test(uuid)) {
        return res.status(400).json({
            error: 'Некорректный формат идентификатора посетителя'
        });
    }

    next();
}

// Проверка прав на редактирование конкретного посетителя
async function canEditVisitor(req, res, next) {
    try {
        const { id } = req.params;
        const userRole = req.user.role;
        const userId = req.user.id;

        // Администратор может редактировать любого
        if (userRole === 'admin') {
            return next();
        }

        // Модератор может редактировать посетителей
        if (userRole === 'moderator') {
            // Можно добавить дополнительные проверки, например:
            // - Модератор может редактировать только посетителей своих событий
            // - Или посетителей, которых сам создал

            // Пока что разрешаем модератору редактировать всех
            return next();
        }

        // СКД не может редактировать
        return res.status(403).json({
            error: 'Недостаточно прав для редактирования посетителей',
            required_roles: ['admin', 'moderator'],
            current_role: userRole
        });

    } catch (err) {
        console.error('Ошибка проверки прав на редактирование:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
}

// Проверка прав на изменение штрихкода
function canModifyBarcode(req, res, next) {
    const userRole = req.user.role;

    // Только администратор может изменять штрихкоды
    if (userRole === 'admin') {
        return next();
    }

    // Для модераторов проверяем, пытается ли он изменить штрихкод
    if (userRole === 'moderator') {
        const { barcode } = req.body;

        // Если штрихкод не передан или пустой, значит изменения нет
        if (!barcode || barcode.trim() === '') {
            return next();
        }

        // Если штрихкод передан, проверяем, отличается ли он от текущего
        // Эта проверка будет выполнена в основной логике route
        req.barcodeModificationAttempt = true;
        return next();
    }

    return res.status(403).json({
        error: 'Недостаточно прав для изменения штрихкода',
        required_roles: ['admin'],
        current_role: userRole
    });
}

// Проверка лимитов на количество изменений
function checkEditLimits(req, res, next) {
    const userRole = req.user.role;

    // Устанавливаем лимиты в зависимости от роли
    const limits = {
        admin: { daily_edits: null }, // Без ограничений
        moderator: { daily_edits: 50 }, // 50 редактирований в день
        skd: { daily_edits: 0 } // СКД не может редактировать
    };

    const userLimits = limits[userRole];

    // Если лимит не установлен (null), пропускаем проверку
    if (userLimits.daily_edits === null) {
        return next();
    }

    // Если лимит 0, блокируем
    if (userLimits.daily_edits === 0) {
        return res.status(403).json({
            error: 'Редактирование запрещено для данной роли',
            current_role: userRole
        });
    }

    // В реальной системе здесь можно добавить проверку количества
    // редактирований пользователя за день из базы данных

    next();
}

// Проверка прав на экспорт данных
function canExportData(req, res, next) {
    const userRole = req.user.role;

    if (['admin', 'moderator', 'skd'].includes(userRole)) {
        req.exportPermissions = {
            canExportVisitors: ['admin', 'moderator'].includes(userRole),
            canExportUsers: userRole === 'admin',
            canExportScans: true,
            canExportEvents: ['admin', 'moderator'].includes(userRole),
            canViewPersonalData: ['admin', 'moderator'].includes(userRole)
        };
        return next();
    }

    return res.status(403).json({
        error: 'Недостаточно прав для экспорта данных'
    });
}

// Проверка прав на экспорт статистики сканирований
function canExportScanStatistics(req, res, next) {
    const userRole = req.user.role;

    if (['admin', 'moderator', 'skd'].includes(userRole)) {
        req.exportPermissions = {
            canViewPersonalData: ['admin', 'moderator'].includes(userRole),
            canViewAllEvents: ['admin', 'moderator'].includes(userRole),
            canViewDetailedStats: true,
            maxExportRows: userRole === 'admin' ? null : 1000
        };
        return next();
    }

    return res.status(403).json({
        error: 'Недостаточно прав для экспорта статистики'
    });
}

// Проверка лимитов экспорта
function checkExportLimits(req, res, next) {
    const userRole = req.user.role;
    const { limit, date_from, date_to } = req.query;

    const limits = {
        admin: { maxRows: null, maxDaysRange: null },
        moderator: { maxRows: 5000, maxDaysRange: 365 },
        skd: { maxRows: 1000, maxDaysRange: 30 }
    };

    const userLimits = limits[userRole];

    if (userLimits.maxRows && limit && parseInt(limit) > userLimits.maxRows) {
        return res.status(400).json({
            error: `Превышен лимит экспорта. Максимум ${userLimits.maxRows} записей для роли ${userRole}`
        });
    }

    if (userLimits.maxDaysRange && date_from && date_to) {
        const fromDate = new Date(date_from);
        const toDate = new Date(date_to);
        const daysDiff = Math.ceil((toDate - fromDate) / (1000 * 60 * 60 * 24));

        if (daysDiff > userLimits.maxDaysRange) {
            return res.status(400).json({
                error: `Превышен лимит диапазона дат. Максимум ${userLimits.maxDaysRange} дней для роли ${userRole}`
            });
        }
    }

    next();
}

// Логирование экспорта данных
function logExportAction(exportType) {
    return async (req, res, next) => {
        try {
            const logData = {
                userId: req.user?.id,
                username: req.user?.username,
                action: `export_${exportType}`,
                exportType: exportType,
                ip: req.ip,
                userAgent: req.get('User-Agent'),
                timestamp: new Date(),
                filters: {
                    event_id: req.query.event_id,
                    status: req.query.status,
                    date_from: req.query.date_from,
                    date_to: req.query.date_to,
                    format: req.query.format
                }
            };

            if (process.env.NODE_ENV === 'development') {
                console.log('📊 Экспорт данных:', logData);
            }

            req.exportLog = logData;
            next();
        } catch (err) {
            console.error('Ошибка логирования экспорта:', err);
            next();
        }
    };
}

// Логирование действий редактирования
function logEditAction(req, res, next) {
    const originalSend = res.json;

    res.json = function(data) {
        // Логируем только успешные операции редактирования
        if (res.statusCode >= 200 && res.statusCode < 300) {
            const logData = {
                userId: req.user?.id,
                username: req.user?.username,
                action: 'edit_visitor',
                visitorId: req.params.id,
                ip: req.ip,
                userAgent: req.get('User-Agent'),
                timestamp: new Date(),
                changes: data.changes || {},
                method: req.method
            };

            if (process.env.NODE_ENV === 'development') {
                console.log('✏️ Редактирование посетителя:', logData);
            }

            // В production можно сохранять в базу данных для аудита
        }

        originalSend.call(this, data);
    };

    next();
}

// Экспорты модуля
module.exports = {
    requireAuth,
    requireRole,
    requireScanAuth,
    logUserAction,
    canModifyVisitor,
    canBlockVisitor,
    canManageUsers,
    validateVisitorUUID,
    canEditVisitor,
    canModifyBarcode,
    checkEditLimits,
    canExportData,
    canExportScanStatistics,
    checkExportLimits,
    logExportAction,
    logEditAction
};