const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const { query, transaction } = require('../config/database');
const router = express.Router();

// Валидация данных входа
const loginValidation = [
    body('username')
        .trim()
        .isLength({ min: 3, max: 50 })
        .withMessage('Логин должен содержать от 3 до 50 символов')
        .matches(/^[a-zA-Z0-9_]+$/)
        .withMessage('Логин может содержать только буквы, цифры и знак подчеркивания'),
    body('password')
        .isLength({ min: 6 })
        .withMessage('Пароль должен содержать минимум 6 символов')
];

// Авторизация
router.post('/login', loginValidation, async (req, res) => {
    try {
        // Проверка валидации
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Ошибки валидации',
                details: errors.array()
            });
        }

        const { username, password } = req.body;

        // Получаем пользователя из базы
        const userResult = await query(
            'SELECT id, username, password_hash, role, full_name, is_active FROM users WHERE username = $1',
            [username]
        );

        if (!userResult.rows.length) {
            return res.status(401).json({ error: 'Неверный логин или пароль' });
        }

        const user = userResult.rows[0];

        // Проверяем активность пользователя
        if (!user.is_active) {
            return res.status(401).json({ error: 'Аккаунт заблокирован' });
        }

        // Проверяем пароль
        const isValidPassword = await bcrypt.compare(password, user.password_hash);
        if (!isValidPassword) {
            return res.status(401).json({ error: 'Неверный логин или пароль' });
        }

        // Создаем сессию
        req.session.userId = user.id;
        req.session.userRole = user.role;

        // Создаем запись о сессии в базе
        await query(
            `INSERT INTO user_sessions (user_id, session_token, expires_at, ip_address, user_agent) 
             VALUES ($1, $2, $3, $4, $5)`,
            [
                user.id,
                req.sessionID,
                new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 часа
                req.ip,
                req.get('User-Agent')
            ]
        );

        res.json({
            success: true,
            user: {
                id: user.id,
                username: user.username,
                role: user.role,
                fullName: user.full_name
            },
            message: 'Авторизация успешна'
        });

    } catch (err) {
        console.error('Ошибка авторизации:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Выход из системы
router.post('/logout', async (req, res) => {
    try {
        if (req.session.userId) {
            // Удаляем сессию из базы
            await query(
                'DELETE FROM user_sessions WHERE session_token = $1',
                [req.sessionID]
            );
        }

        // Уничтожаем сессию
        req.session.destroy((err) => {
            if (err) {
                console.error('Ошибка уничтожения сессии:', err);
                return res.status(500).json({ error: 'Ошибка выхода из системы' });
            }

            res.json({ success: true, message: 'Выход выполнен успешно' });
        });

    } catch (err) {
        console.error('Ошибка выхода:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Проверка текущей авторизации
router.get('/check', async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({ authenticated: false });
        }

        // Проверяем актуальность пользователя
        const userResult = await query(
            'SELECT id, username, role, full_name, is_active FROM users WHERE id = $1',
            [req.session.userId]
        );

        if (!userResult.rows.length || !userResult.rows[0].is_active) {
            req.session.destroy();
            return res.status(401).json({ authenticated: false });
        }

        const user = userResult.rows[0];

        res.json({
            authenticated: true,
            user: {
                id: user.id,
                username: user.username,
                role: user.role,
                fullName: user.full_name
            }
        });

    } catch (err) {
        console.error('Ошибка проверки авторизации:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Смена пароля
router.post('/change-password', async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({ error: 'Требуется авторизация' });
        }

        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'Требуются текущий и новый пароли' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'Новый пароль должен содержать минимум 6 символов' });
        }

        // Получаем текущий хеш пароля
        const userResult = await query(
            'SELECT password_hash FROM users WHERE id = $1',
            [req.session.userId]
        );

        if (!userResult.rows.length) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        // Проверяем текущий пароль
        const isValidPassword = await bcrypt.compare(currentPassword, userResult.rows[0].password_hash);
        if (!isValidPassword) {
            return res.status(400).json({ error: 'Неверный текущий пароль' });
        }

        // Хешируем новый пароль
        const saltRounds = 12;
        const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);

        // Обновляем пароль
        await query(
            'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP, updated_by = $2 WHERE id = $2',
            [newPasswordHash, req.session.userId]
        );

        res.json({ success: true, message: 'Пароль успешно изменен' });

    } catch (err) {
        console.error('Ошибка смены пароля:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Получение списка активных сессий пользователя
router.get('/sessions', async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({ error: 'Требуется авторизация' });
        }

        const sessionsResult = await query(
            `SELECT session_token, created_at, expires_at, ip_address, user_agent,
                    CASE WHEN session_token = $2 THEN true ELSE false END as is_current
             FROM user_sessions 
             WHERE user_id = $1 AND expires_at > CURRENT_TIMESTAMP
             ORDER BY created_at DESC`,
            [req.session.userId, req.sessionID]
        );

        const sessions = sessionsResult.rows.map(session => ({
            id: session.session_token,
            createdAt: session.created_at,
            expiresAt: session.expires_at,
            ipAddress: session.ip_address,
            userAgent: session.user_agent,
            isCurrent: session.is_current
        }));

        res.json({ sessions });

    } catch (err) {
        console.error('Ошибка получения сессий:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Завершение сессии по ID
router.delete('/sessions/:sessionId', async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({ error: 'Требуется авторизация' });
        }

        const { sessionId } = req.params;

        if (sessionId === req.sessionID) {
            return res.status(400).json({ error: 'Нельзя завершить текущую сессию' });
        }

        const result = await query(
            'DELETE FROM user_sessions WHERE session_token = $1 AND user_id = $2',
            [sessionId, req.session.userId]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Сессия не найдена' });
        }

        res.json({ success: true, message: 'Сессия завершена' });

    } catch (err) {
        console.error('Ошибка завершения сессии:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

module.exports = router;