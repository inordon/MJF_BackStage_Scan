// scripts/reset-database.js
// Скрипт для полного сброса и пересоздания базы данных

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Конфигурация подключения к базе данных
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'visitor_system',
    user: process.env.DB_USER || 'visitor_admin',
    password: process.env.DB_PASSWORD || 'secure_password_123'
};

// Конфигурация для подключения к postgres (для пересоздания БД)
const postgresConfig = {
    ...dbConfig,
    database: 'postgres'
};

async function resetDatabase() {
    console.log('🔄 Начинаем сброс базы данных...\n');

    const postgresPool = new Pool(postgresConfig);

    try {
        // 1. Завершаем все активные соединения с БД
        console.log('1️⃣ Завершение активных соединений...');
        await postgresPool.query(`
            SELECT pg_terminate_backend(pg_stat_activity.pid)
            FROM pg_stat_activity
            WHERE pg_stat_activity.datname = $1
              AND pid <> pg_backend_pid()
        `, [dbConfig.database]);

        // 2. Удаляем существующую базу данных
        console.log('2️⃣ Удаление существующей базы данных...');
        await postgresPool.query(`DROP DATABASE IF EXISTS ${dbConfig.database}`);

        // 3. Создаем новую базу данных
        console.log('3️⃣ Создание новой базы данных...');
        await postgresPool.query(`CREATE DATABASE ${dbConfig.database}`);

        console.log('✅ База данных пересоздана\n');

    } catch (err) {
        console.error('❌ Ошибка при пересоздании базы данных:', err.message);
        process.exit(1);
    } finally {
        await postgresPool.end();
    }

    // 4. Инициализируем новую базу данных
    console.log('4️⃣ Инициализация структуры базы данных...');

    const appPool = new Pool(dbConfig);

    try {
        // Читаем SQL скрипт инициализации
        const initSqlPath = path.join(__dirname, '..', 'init.sql');

        if (!fs.existsSync(initSqlPath)) {
            throw new Error(`Файл init.sql не найден: ${initSqlPath}`);
        }

        const initSql = fs.readFileSync(initSqlPath, 'utf8');

        // Выполняем SQL скрипт
        await appPool.query(initSql);

        console.log('✅ Структура базы данных создана');

        // 5. Проверяем результат
        console.log('\n5️⃣ Проверка созданной структуры...');

        const tablesResult = await appPool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            ORDER BY table_name
        `);

        console.log('📋 Созданные таблицы:');
        tablesResult.rows.forEach(row => {
            console.log(`   • ${row.table_name}`);
        });

        // Проверяем количество пользователей
        const usersResult = await appPool.query('SELECT COUNT(*) as count FROM users');
        console.log(`\n👥 Создано пользователей: ${usersResult.rows[0].count}`);

        // Проверяем количество тестовых посетителей
        const visitorsResult = await appPool.query('SELECT COUNT(*) as count FROM visitors');
        console.log(`🚶 Создано тестовых посетителей: ${visitorsResult.rows[0].count}`);

        console.log('\n🎉 База данных успешно сброшена и инициализирована!');
        console.log('\n🔐 Демо аккаунты:');
        console.log('   👑 admin / admin123');
        console.log('   ⚙️ moderator / moderator123');
        console.log('   🔒 skd_user / skd123');

    } catch (err) {
        console.error('❌ Ошибка при инициализации базы данных:', err.message);
        process.exit(1);
    } finally {
        await appPool.end();
    }
}

// Функция подтверждения действия
function askConfirmation() {
    return new Promise((resolve) => {
        const readline = require('readline');
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        rl.question('⚠️  ВНИМАНИЕ! Это действие полностью удалит все данные в базе.\nВы уверены? (yes/no): ', (answer) => {
            rl.close();
            resolve(answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y');
        });
    });
}

// Главная функция
async function main() {
    console.log('🗄️  Скрипт сброса базы данных');
    console.log('=' .repeat(50));

    try {
        // Проверяем переменные окружения
        console.log('📋 Конфигурация:');
        console.log(`   Host: ${dbConfig.host}:${dbConfig.port}`);
        console.log(`   Database: ${dbConfig.database}`);
        console.log(`   User: ${dbConfig.user}`);
        console.log('');

        // Запрашиваем подтверждение
        const confirmed = await askConfirmation();

        if (!confirmed) {
            console.log('❌ Операция отменена пользователем');
            process.exit(0);
        }

        // Выполняем сброс
        await resetDatabase();

    } catch (err) {
        console.error('💥 Критическая ошибка:', err.message);
        process.exit(1);
    }
}

// Запускаем только если файл выполняется напрямую
if (require.main === module) {
    main();
}

module.exports = { resetDatabase };