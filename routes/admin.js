const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const { query, getDBStats, healthCheck } = require('../config/database');
const { requireAuth, requireRole, canManageUsers } = require('../middleware/auth');

const router = express.Router();

// Валидация данных пользователя
const userValidation = [
    body('username')
        .trim()
        .isLength({ min: 3, max: 50 })
        .withMessage('Логин должен содержать от 3 до 50 символов')
        .matches(/^[a-zA-Z0-9_]+$/)
        .withMessage('Логин может содержать только буквы, цифры и знак подчеркивания'),
    body('password')
        .isLength({ min: 6 })
        .withMessage('Пароль должен содержать минимум 6 символов'),
    body('fullName')
        .trim()
        .isLength({ min: 2, max: 100 })
        .withMessage('Полное имя должно содержать от 2 до 100 символов'),
    body('role')
        .isIn(['admin', 'moderator', 'skd'])
        .withMessage('Некорректная роль пользователя'),
    body('email')
        .optional({ checkFalsy: true })
        .isEmail()
        .withMessage('Некорректный email адрес')
];

// Получение списка пользователей
router.get('/users', requireAuth, canManageUsers, async (req, res) => {
    try {
        const { page = 1, limit = 50, role, active_only } = req.query;
        const offset = (page - 1) * limit;

        let queryText = `
            SELECT
                u.id, u.username, u.role, u.full_name, u.email,
                u.is_active, u.created_at, u.updated_at, u.last_login,
                creator.full_name as created_by_name
            FROM users u
                     LEFT JOIN users creator ON u.created_by = creator.id
        `;

        const conditions = [];
        const params = [];

        if (role && ['admin', 'moderator', 'skd'].includes(role)) {
            conditions.push(`u.role = $${params.length + 1}`);
            params.push(role);
        }

        if (active_only === 'true') {
            conditions.push(`u.is_active = true`);
        }

        if (conditions.length > 0) {
            queryText += ' WHERE ' + conditions.join(' AND ');
        }

        queryText += `
            ORDER BY u.created_at DESC
            LIMIT $${params.length + 1} OFFSET $${params.length + 2}
        `;

        params.push(limit, offset);

        const usersResult = await query(queryText, params);

        // Получаем общее количество пользователей
        let countQuery = 'SELECT COUNT(*) as total FROM users u';
        if (conditions.length > 0) {
            countQuery += ' WHERE ' + conditions.join(' AND ');
        }

        const countResult = await query(countQuery, params.slice(0, -2));
        const total = parseInt(countResult.rows[0].total);

        res.json({
            users: usersResult.rows.map(user => ({
                id: user.id,
                username: user.username,
                role: user.role,
                fullName: user.full_name,
                email: user.email,
                isActive: user.is_active,
                createdAt: user.created_at,
                updatedAt: user.updated_at,
                lastLogin: user.last_login,
                createdByName: user.created_by_name
            })),
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: total,
                pages: Math.ceil(total / limit)
            }
        });

    } catch (err) {
        console.error('Ошибка получения списка пользователей:', err);
        res.status(500).json({
            error: 'Ошибка сервера при получении пользователей',
            details: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
});

// Создание нового пользователя
router.post('/users', requireAuth, canManageUsers, userValidation, async (req, res) => {
    try {
        console.log('📝 Создание нового пользователя...');

        // Проверка валидации
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            console.log('❌ Ошибки валидации:', errors.array());
            return res.status(400).json({
                error: 'Ошибки валидации',
                details: errors.array()
            });
        }

        const { username, password, fullName, role, email } = req.body;

        // Проверяем уникальность логина
        const existingUser = await query(
            'SELECT id FROM users WHERE username = $1',
            [username]
        );

        if (existingUser.rows.length > 0) {
            console.log('❌ Пользователь с таким логином уже существует');
            return res.status(400).json({ error: 'Пользователь с таким логином уже существует' });
        }

        // Проверяем уникальность email (если указан)
        if (email) {
            const existingEmail = await query(
                'SELECT id FROM users WHERE email = $1',
                [email]
            );

            if (existingEmail.rows.length > 0) {
                console.log('❌ Пользователь с таким email уже существует');
                return res.status(400).json({ error: 'Пользователь с таким email уже существует' });
            }
        }

        // Хешируем пароль
        const saltRounds = 12;
        const passwordHash = await bcrypt.hash(password, saltRounds);

        // Создаем пользователя
        const newUserResult = await query(`
            INSERT INTO users (
                username, password_hash, full_name, role, email,
                is_active, created_by
            ) VALUES ($1, $2, $3, $4, $5, true, $6)
                RETURNING id, username, full_name, role, email, is_active, created_at
        `, [
            username, passwordHash, fullName, role,
            email || null, req.user.id
        ]);

        const newUser = newUserResult.rows[0];
        console.log('✅ Пользователь создан успешно:', {
            id: newUser.id,
            username: newUser.username,
            role: newUser.role
        });

        res.status(201).json({
            message: 'Пользователь успешно создан',
            user: {
                id: newUser.id,
                username: newUser.username,
                fullName: newUser.full_name,
                role: newUser.role,
                email: newUser.email,
                isActive: newUser.is_active,
                createdAt: newUser.created_at
            }
        });

    } catch (err) {
        console.error('❌ Ошибка создания пользователя:', err);

        let errorMessage = 'Ошибка сервера при создании пользователя';
        let statusCode = 500;

        if (err.code === '23505') { // Unique constraint violation
            if (err.constraint && err.constraint.includes('username')) {
                errorMessage = 'Пользователь с таким логином уже существует';
                statusCode = 400;
            } else if (err.constraint && err.constraint.includes('email')) {
                errorMessage = 'Пользователь с таким email уже существует';
                statusCode = 400;
            }
        }

        res.status(statusCode).json({
            error: errorMessage,
            details: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
});

// Обновление пользователя
router.put('/users/:id', requireAuth, canManageUsers, async (req, res) => {
    try {
        const { id } = req.params;
        const { fullName, role, email, isActive } = req.body;

        console.log(`📝 Обновление пользователя ID: ${id}`);

        // Проверяем существование пользователя
        const existingUser = await query('SELECT * FROM users WHERE id = $1', [id]);

        if (!existingUser.rows.length) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        // Нельзя изменить самого себя
        if (parseInt(id) === req.user.id) {
            return res.status(400).json({ error: 'Нельзя изменить собственную учетную запись' });
        }

        // Проверяем уникальность email (если изменяется)
        if (email && email !== existingUser.rows[0].email) {
            const emailCheck = await query(
                'SELECT id FROM users WHERE email = $1 AND id != $2',
                [email, id]
            );

            if (emailCheck.rows.length > 0) {
                return res.status(400).json({ error: 'Пользователь с таким email уже существует' });
            }
        }

        const result = await query(`
            UPDATE users SET
                             full_name = $1, role = $2, email = $3, is_active = $4,
                             updated_at = CURRENT_TIMESTAMP, updated_by = $5
            WHERE id = $6
                RETURNING id, username, full_name, role, email, is_active, updated_at
        `, [
            fullName || existingUser.rows[0].full_name,
            role || existingUser.rows[0].role,
            email,
            isActive !== undefined ? isActive : existingUser.rows[0].is_active,
            req.user.id,
            id
        ]);

        console.log('✅ Пользователь обновлен успешно');

        res.json({
            message: 'Пользователь успешно обновлен',
            user: {
                id: result.rows[0].id,
                username: result.rows[0].username,
                fullName: result.rows[0].full_name,
                role: result.rows[0].role,
                email: result.rows[0].email,
                isActive: result.rows[0].is_active,
                updatedAt: result.rows[0].updated_at
            }
        });

    } catch (err) {
        console.error('❌ Ошибка обновления пользователя:', err);
        res.status(500).json({
            error: 'Ошибка сервера при обновлении пользователя',
            details: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
});

// Сброс пароля пользователя
router.post('/users/:id/reset-password', requireAuth, canManageUsers, async (req, res) => {
    try {
        const { id } = req.params;
        const { newPassword } = req.body;

        console.log(`🔐 Сброс пароля для пользователя ID: ${id}`);

        if (!newPassword || newPassword.length < 6) {
            return res.status(400).json({ error: 'Новый пароль должен содержать минимум 6 символов' });
        }

        // Проверяем существование пользователя
        const userCheck = await query('SELECT username FROM users WHERE id = $1', [id]);

        if (!userCheck.rows.length) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        // Хешируем новый пароль
        const saltRounds = 12;
        const passwordHash = await bcrypt.hash(newPassword, saltRounds);

        await query(
            'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP, updated_by = $2 WHERE id = $3',
            [passwordHash, req.user.id, id]
        );

        // Завершаем все сессии пользователя
        await query('DELETE FROM user_sessions WHERE user_id = $1', [id]);

        console.log('✅ Пароль сброшен успешно');

        res.json({
            message: 'Пароль успешно сброшен и все сессии пользователя завершены',
            username: userCheck.rows[0].username
        });

    } catch (err) {
        console.error('❌ Ошибка сброса пароля:', err);
        res.status(500).json({
            error: 'Ошибка сервера при сбросе пароля',
            details: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
});

// Удаление пользователя
router.delete('/users/:id', requireAuth, canManageUsers, async (req, res) => {
    try {
        const { id } = req.params;

        console.log(`🗑️ Удаление пользователя ID: ${id}`);

        // Нельзя удалить самого себя
        if (parseInt(id) === req.user.id) {
            return res.status(400).json({ error: 'Нельзя удалить собственную учетную запись' });
        }

        // Проверяем существование пользователя
        const userCheck = await query('SELECT username FROM users WHERE id = $1', [id]);

        if (!userCheck.rows.length) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        // Удаляем сессии пользователя
        await query('DELETE FROM user_sessions WHERE user_id = $1', [id]);

        // Обнуляем ссылки на пользователя в связанных таблицах
        await query('UPDATE visitors SET created_by = NULL WHERE created_by = $1', [id]);
        await query('UPDATE visitors SET updated_by = NULL WHERE updated_by = $1', [id]);
        await query('UPDATE scans SET scanned_by = NULL WHERE scanned_by = $1', [id]);

        // Удаляем пользователя
        const result = await query('DELETE FROM users WHERE id = $1 RETURNING username', [id]);

        console.log('✅ Пользователь удален успешно');

        res.json({
            message: 'Пользователь успешно удален',
            username: result.rows[0].username
        });

    } catch (err) {
        console.error('❌ Ошибка удаления пользователя:', err);
        res.status(500).json({
            error: 'Ошибка сервера при удалении пользователя',
            details: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
});

// Проверка здоровья системы
router.get('/health', async (req, res) => {
    try {
        const dbHealth = await healthCheck();

        res.status(dbHealth.healthy ? 200 : 503).json({
            healthy: dbHealth.healthy,
            database: dbHealth,
            timestamp: new Date(),
            version: process.env.APP_VERSION || '1.0.0',
            node_version: process.version,
            uptime: process.uptime()
        });

    } catch (err) {
        console.error('❌ Ошибка проверки здоровья системы:', err);
        res.status(503).json({
            healthy: false,
            error: 'Ошибка проверки системы',
            timestamp: new Date()
        });
    }
});

// Системная статистика
router.get('/stats', requireAuth, requireRole(['admin']), async (req, res) => {
    try {
        const dbStats = await getDBStats();

        const systemStats = {
            database: dbStats,
            system: {
                node_version: process.version,
                uptime: process.uptime(),
                memory_usage: process.memoryUsage(),
                platform: process.platform,
                arch: process.arch
            },
            timestamp: new Date()
        };

        res.json(systemStats);

    } catch (err) {
        console.error('❌ Ошибка получения статистики:', err);
        res.status(500).json({
            error: 'Ошибка сервера',
            details: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
});

module.exports = router;