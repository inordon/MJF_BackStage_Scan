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
        // Для сканирования достаточно любой авторизации
        if (!req.session.userId) {
            return res.status(401).json({
                error: 'Требуется авторизация для сканирования',
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

        const user = userResult.rows[0];

        // Все роли могут сканировать
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

            // В production можно отправлять в систему логирования
            if (process.env.NODE_ENV === 'development') {
                console.log('👤 Действие пользователя:', logData);
            }

            next();
        } catch (err) {
            console.error('Ошибка логирования действия:', err);
            next(); // Продолжаем выполнение, даже если логирование не удалось
        }
    };
}

// Проверка прав на изменение данных посетителя
function canModifyVisitor(req, res, next) {
    const userRole = req.user.role;

    // Администратор и модератор могут изменять данные
    if (['admin', 'moderator'].includes(userRole)) {
        return next();
    }

    return res.status(403).json({
        error: 'Недостаточно прав для изменения данных посетителей'
    });
}

// Проверка прав на блокировку посетителей
function canBlockVisitor(req, res, next) {
    const userRole = req.user.role;

    // Администратор и модератор могут блокировать
    if (['admin', 'moderator'].includes(userRole)) {
        return next();
    }

    return res.status(403).json({
        error: 'Недостаточно прав для блокировки посетителей'
    });
}

// Проверка прав на создание пользователей
function canManageUsers(req, res, next) {
    const userRole = req.user.role;

    // Только администратор может управлять пользователями
    if (userRole === 'admin') {
        return next();
    }

    return res.status(403).json({
        error: 'Недостаточно прав для управления пользователями'
    });
}

// Валидация UUID для посетителей
function validateVisitorUUID(req, res, next) {
    const { uuid } = req.params;

    // Простая проверка формата UUID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    if (!uuid || !uuidRegex.test(uuid)) {
        return res.status(400).json({
            error: 'Некорректный формат идентификатора посетителя'
        });
    }

    next();
}

module.exports = {
    requireAuth,
    requireRole,
    requireScanAuth,
    logUserAction,
    canModifyVisitor,
    canBlockVisitor,
    canManageUsers,
    validateVisitorUUID
};