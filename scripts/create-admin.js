// scripts/create-admin.js
// Скрипт для создания нового администратора

const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const readline = require('readline');

// Конфигурация подключения к базе данных
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'visitor_system',
    user: process.env.DB_USER || 'visitor_admin',
    password: process.env.DB_PASSWORD || 'secure_password_123'
};

// Создание интерфейса для ввода данных
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// Функция для ввода данных
function askQuestion(question) {
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            resolve(answer.trim());
        });
    });
}

// Функция для ввода пароля (скрытый ввод)
function askPassword(question) {
    return new Promise((resolve) => {
        process.stdout.write(question);

        // Скрываем ввод пароля
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.setEncoding('utf8');

        let password = '';

        process.stdin.on('data', function(char) {
            char = char + '';

            switch(char) {
                case '\n':
                case '\r':
                case '\u0004':
                    // Enter
                    process.stdin.setRawMode(false);
                    process.stdin.pause();
                    process.stdout.write('\n');
                    resolve(password);
                    break;
                case '\u0003':
                    // Ctrl+C
                    process.exit();
                    break;
                case '\u007f':
                    // Backspace
                    if (password.length > 0) {
                        password = password.slice(0, -1);
                        process.stdout.write('\b \b');
                    }
                    break;
                default:
                    // Обычный символ
                    password += char;
                    process.stdout.write('*');
                    break;
            }
        });
    });
}

// Валидация email
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

// Валидация логина
function isValidUsername(username) {
    const usernameRegex = /^[a-zA-Z0-9_]{3,50}$/;
    return usernameRegex.test(username);
}

// Главная функция создания администратора
async function createAdmin() {
    console.log('👑 Создание нового администратора');
    console.log('=' .repeat(50));

    const pool = new Pool(dbConfig);

    try {
        // Ввод данных администратора
        let username, password, confirmPassword, fullName, email;

        // Логин
        while (true) {
            username = await askQuestion('📝 Введите логин (3-50 символов, только буквы, цифры, _): ');

            if (!isValidUsername(username)) {
                console.log('❌ Некорректный логин. Используйте только буквы, цифры и символ подчеркивания.');
                continue;
            }

            // Проверяем уникальность
            const existingUser = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
            if (existingUser.rows.length > 0) {
                console.log('❌ Пользователь с таким логином уже существует.');
                continue;
            }

            break;
        }

        // Пароль
        while (true) {
            password = await askPassword('🔒 Введите пароль (минимум 6 символов): ');

            if (password.length < 6) {
                console.log('❌ Пароль должен содержать минимум 6 символов.');
                continue;
            }

            confirmPassword = await askPassword('🔒 Подтвердите пароль: ');

            if (password !== confirmPassword) {
                console.log('❌ Пароли не совпадают.');
                continue;
            }

            break;
        }

        // Полное имя
        while (true) {
            fullName = await askQuestion('👤 Введите полное имя (2-100 символов): ');

            if (fullName.length < 2 || fullName.length > 100) {
                console.log('❌ Полное имя должно содержать от 2 до 100 символов.');
                continue;
            }

            break;
        }

        // Email (опционально)
        while (true) {
            email = await askQuestion('📧 Введите email (опционально, Enter для пропуска): ');

            if (email === '') {
                email = null;
                break;
            }

            if (!isValidEmail(email)) {
                console.log('❌ Некорректный формат email.');
                continue;
            }

            // Проверяем уникальность email
            const existingEmail = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
            if (existingEmail.rows.length > 0) {
                console.log('❌ Пользователь с таким email уже существует.');
                continue;
            }

            break;
        }

        console.log('\n📋 Подтверждение данных:');
        console.log(`   Логин: ${username}`);
        console.log(`   Полное имя: ${fullName}`);
        console.log(`   Email: ${email || 'не указан'}`);
        console.log(`   Роль: Администратор`);

        const confirm = await askQuestion('\n✅ Создать администратора? (yes/no): ');

        if (confirm.toLowerCase() !== 'yes' && confirm.toLowerCase() !== 'y') {
            console.log('❌ Создание администратора отменено.');
            return;
        }

        // Хешируем пароль
        console.log('\n🔐 Хеширование пароля...');
        const saltRounds = 12;
        const passwordHash = await bcrypt.hash(password, saltRounds);

        // Создаем администратора
        console.log('💾 Создание записи в базе данных...');
        const result = await pool.query(`
            INSERT INTO users (
                username, password_hash, full_name, role, email, is_active
            ) VALUES ($1, $2, $3, 'admin', $4, true)
            RETURNING id, username, full_name, created_at
        `, [username, passwordHash, fullName, email]);

        const newAdmin = result.rows[0];

        console.log('\n🎉 Администратор успешно создан!');
        console.log(`   ID: ${newAdmin.id}`);
        console.log(`   Логин: ${newAdmin.username}`);
        console.log(`   Имя: ${newAdmin.full_name}`);
        console.log(`   Создан: ${new Date(newAdmin.created_at).toLocaleString('ru-RU')}`);

        // Показываем статистику пользователей
        const usersStats = await pool.query(`
            SELECT 
                role,
                COUNT(*) as count
            FROM users 
            WHERE is_active = true
            GROUP BY role
            ORDER BY role
        `);

        console.log('\n📊 Активные пользователи в системе:');
        usersStats.rows.forEach(stat => {
            const roleNames = {
                'admin': '👑 Администраторы',
                'moderator': '⚙️ Модераторы',
                'skd': '🔒 СКД'
            };
            console.log(`   ${roleNames[stat.role] || stat.role}: ${stat.count}`);
        });

    } catch (err) {
        console.error('❌ Ошибка создания администратора:', err.message);

        if (err.code === '23505') { // Unique violation
            console.error('💡 Пользователь с такими данными уже существует.');
        }

        process.exit(1);
    } finally {
        await pool.end();
        rl.close();
    }
}

// Функция для создания администратора из параметров командной строки
async function createAdminFromArgs() {
    const args = process.argv.slice(2);

    if (args.length < 3) {
        console.log('❌ Недостаточно параметров');
        console.log('Использование: node create-admin.js <username> <password> <fullName> [email]');
        console.log('Пример: node create-admin.js newadmin mypassword123 "Новый Администратор" admin@example.com');
        return;
    }

    const [username, password, fullName, email] = args;

    const pool = new Pool(dbConfig);

    try {
        // Валидация
        if (!isValidUsername(username)) {
            throw new Error('Некорректный логин');
        }

        if (password.length < 6) {
            throw new Error('Пароль должен содержать минимум 6 символов');
        }

        if (fullName.length < 2) {
            throw new Error('Полное имя должно содержать минимум 2 символа');
        }

        if (email && !isValidEmail(email)) {
            throw new Error('Некорректный email');
        }

        // Проверяем уникальность
        const existingUser = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
        if (existingUser.rows.length > 0) {
            throw new Error('Пользователь с таким логином уже существует');
        }

        if (email) {
            const existingEmail = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
            if (existingEmail.rows.length > 0) {
                throw new Error('Пользователь с таким email уже существует');
            }
        }

        // Создаем администратора
        const passwordHash = await bcrypt.hash(password, 12);

        const result = await pool.query(`
            INSERT INTO users (
                username, password_hash, full_name, role, email, is_active
            ) VALUES ($1, $2, $3, 'admin', $4, true)
            RETURNING id, username, full_name, created_at
        `, [username, passwordHash, fullName, email || null]);

        const newAdmin = result.rows[0];

        console.log('✅ Администратор создан:');
        console.log(`   ID: ${newAdmin.id}`);
        console.log(`   Логин: ${newAdmin.username}`);
        console.log(`   Имя: ${newAdmin.full_name}`);

    } catch (err) {
        console.error('❌ Ошибка:', err.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

// Главная функция
async function main() {
    try {
        // Проверяем подключение к базе данных
        const pool = new Pool(dbConfig);
        await pool.query('SELECT 1');
        await pool.end();

        // Если есть аргументы командной строки, используем их
        const args = process.argv.slice(2);
        if (args.length > 0) {
            await createAdminFromArgs();
        } else {
            await createAdmin();
        }

    } catch (err) {
        if (err.code === 'ECONNREFUSED') {
            console.error('❌ Не удается подключиться к базе данных');
            console.error('💡 Убедитесь, что PostgreSQL запущен и доступен');
        } else {
            console.error('❌ Ошибка:', err.message);
        }
        process.exit(1);
    }
}

// Запускаем только если файл выполняется напрямую
if (require.main === module) {
    main();
}

module.exports = { createAdmin, createAdminFromArgs };