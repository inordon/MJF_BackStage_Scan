const { Pool } = require('pg');

// Конфигурация подключения к базе данных
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'visitor_system',
    user: process.env.DB_USER || 'visitor_admin',
    password: process.env.DB_PASSWORD || 'secure_password_123',
    max: 20, // максимальное количество соединений в пуле
    idleTimeoutMillis: 30000, // время ожидания неактивного соединения
    connectionTimeoutMillis: 2000, // время ожидания подключения
};

// Создание пула соединений
const pool = new Pool(dbConfig);

// Обработка событий пула
pool.on('connect', () => {
    console.log('✅ Подключение к базе данных установлено');
});

pool.on('error', (err) => {
    console.error('❌ Ошибка подключения к базе данных:', err);
});

// Функция инициализации и проверки подключения
async function initDB() {
    try {
        // Проверяем подключение
        const client = await pool.connect();
        const result = await client.query('SELECT NOW()');
        console.log('🕒 Время базы данных:', result.rows[0].now);
        client.release();

        console.log('✅ База данных инициализирована успешно');
    } catch (err) {
        console.error('❌ Ошибка инициализации базы данных:', err);
        throw err;
    }
}

// Функция для выполнения запросов
async function query(text, params) {
    const start = Date.now();
    try {
        const res = await pool.query(text, params);
        const duration = Date.now() - start;

        if (process.env.NODE_ENV === 'development') {
            console.log('📊 Выполнен запрос:', { text, duration, rows: res.rowCount });
        }

        return res;
    } catch (err) {
        console.error('❌ Ошибка выполнения запроса:', { text, error: err.message });
        throw err;
    }
}

// Функция для работы с транзакциями
async function transaction(callback) {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

// Получение статистики базы данных
async function getDBStats() {
    try {
        const stats = await query(`
            SELECT 
                (SELECT COUNT(*) FROM visitors WHERE status = 'active') as active_visitors,
                (SELECT COUNT(*) FROM visitors WHERE status = 'blocked') as blocked_visitors,
                (SELECT COUNT(*) FROM scans WHERE scan_date = CURRENT_DATE) as today_scans,
                (SELECT COUNT(*) FROM users WHERE is_active = true) as active_users,
                (SELECT COUNT(*) FROM user_sessions WHERE expires_at > CURRENT_TIMESTAMP) as active_sessions
        `);

        return stats.rows[0];
    } catch (err) {
        console.error('❌ Ошибка получения статистики:', err);
        throw err;
    }
}

// Функция для проверки здоровья базы данных
async function healthCheck() {
    try {
        const result = await query('SELECT 1 as healthy');
        return { healthy: true, timestamp: new Date() };
    } catch (err) {
        return { healthy: false, error: err.message, timestamp: new Date() };
    }
}

// Graceful shutdown
async function closePool() {
    console.log('🔌 Закрытие пула соединений с базой данных...');
    await pool.end();
    console.log('✅ Пул соединений закрыт');
}

// Обработка завершения процесса
process.on('SIGTERM', closePool);
process.on('SIGINT', closePool);

module.exports = {
    pool,
    query,
    transaction,
    initDB,
    getDBStats,
    healthCheck,
    closePool
};