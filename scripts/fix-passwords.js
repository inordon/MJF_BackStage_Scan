// scripts/fix-passwords.js
// Скрипт для исправления паролей пользователей в базе данных

const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

// Конфигурация подключения к базе данных
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'visitor_system',
    user: process.env.DB_USER || 'visitor_admin',
    password: process.env.DB_PASSWORD || 'secure_password_123'
};

// Правильные пароли для пользователей
const correctPasswords = {
    'admin': 'admin123',
    'moderator': 'moderator123',
    'skd_user': 'skd123'
};

async function fixPasswords() {
    console.log('🔧 Исправление паролей пользователей...\n');

    const pool = new Pool(dbConfig);

    try {
        // Проверяем подключение
        await pool.query('SELECT 1');
        console.log('✅ Подключение к базе данных установлено');

        // Генерируем новые хеши и обновляем пароли
        for (const [username, password] of Object.entries(correctPasswords)) {
            console.log(`\n🔐 Обновление пароля для пользователя: ${username}`);

            // Генерируем хеш с 12 раундами
            const saltRounds = 12;
            const hash = await bcrypt.hash(password, saltRounds);

            console.log(`   Пароль: ${password}`);
            console.log(`   Хеш: ${hash}`);

            // Обновляем пароль в базе данных
            const result = await pool.query(
                'UPDATE users SET password_hash = $1 WHERE username = $2 RETURNING id, username',
                [hash, username]
            );

            if (result.rows.length > 0) {
                console.log(`   ✅ Пароль обновлен для пользователя ID: ${result.rows[0].id}`);

                // Проверяем что хеш работает
                const isValid = await bcrypt.compare(password, hash);
                console.log(`   🔍 Проверка хеша: ${isValid ? '✅ Работает' : '❌ Не работает'}`);
            } else {
                console.log(`   ⚠️  Пользователь ${username} не найден`);
            }
        }

        console.log('\n📊 Проверка всех пользователей в базе:');

        // Получаем всех пользователей и проверяем их пароли
        const usersResult = await pool.query(
            'SELECT id, username, password_hash, role FROM users ORDER BY id'
        );

        for (const user of usersResult.rows) {
            const expectedPassword = correctPasswords[user.username];

            if (expectedPassword) {
                const isValid = await bcrypt.compare(expectedPassword, user.password_hash);
                console.log(`   ${user.username} (${user.role}): ${isValid ? '✅' : '❌'} ${expectedPassword}`);
            } else {
                console.log(`   ${user.username} (${user.role}): ℹ️  Пользовательский пароль`);
            }
        }

        console.log('\n🎉 Исправление паролей завершено!');

        console.log('\n🔐 Данные для входа:');
        console.log('   👑 admin / admin123');
        console.log('   ⚙️ moderator / moderator123');
        console.log('   🔒 skd_user / skd123');

    } catch (err) {
        console.error('❌ Ошибка:', err.message);

        if (err.code === 'ECONNREFUSED') {
            console.error('💡 Убедитесь что база данных запущена');
        }

        process.exit(1);
    } finally {
        await pool.end();
    }
}

// Функция для тестирования авторизации
async function testLogin() {
    console.log('🧪 Тестирование авторизации...\n');

    const pool = new Pool(dbConfig);

    try {
        for (const [username, password] of Object.entries(correctPasswords)) {
            console.log(`🔐 Тестирование: ${username} / ${password}`);

            // Получаем пользователя
            const userResult = await pool.query(
                'SELECT id, username, password_hash, role, is_active FROM users WHERE username = $1',
                [username]
            );

            if (!userResult.rows.length) {
                console.log(`   ❌ Пользователь не найден`);
                continue;
            }

            const user = userResult.rows[0];

            if (!user.is_active) {
                console.log(`   ❌ Пользователь заблокирован`);
                continue;
            }

            // Проверяем пароль
            const isValid = await bcrypt.compare(password, user.password_hash);
            console.log(`   ${isValid ? '✅ Авторизация успешна' : '❌ Неверный пароль'}`);
        }

    } catch (err) {
        console.error('❌ Ошибка тестирования:', err.message);
    } finally {
        await pool.end();
    }
}

// Главная функция
async function main() {
    const command = process.argv[2];

    switch (command) {
        case 'fix':
            await fixPasswords();
            break;
        case 'test':
            await testLogin();
            break;
        default:
            console.log('🔧 Утилита исправления паролей');
            console.log('=====================================');
            console.log('Использование:');
            console.log('  node fix-passwords.js fix   # Исправить пароли');
            console.log('  node fix-passwords.js test  # Тестировать авторизацию');
            console.log('');
            console.log('Демо пароли:');
            Object.entries(correctPasswords).forEach(([user, pass]) => {
                console.log(`  ${user}: ${pass}`);
            });
    }
}

// Запускаем только если файл выполняется напрямую
if (require.main === module) {
    main().catch(console.error);
}

module.exports = { fixPasswords, testLogin };