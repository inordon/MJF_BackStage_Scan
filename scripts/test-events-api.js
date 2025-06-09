// scripts/test-events-api.js
// Скрипт для тестирования API событий

const { Pool } = require('pg');

// Конфигурация подключения к базе данных
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'visitor_system',
    user: process.env.DB_USER || 'visitor_admin',
    password: process.env.DB_PASSWORD || 'secure_password_123'
};

// Функция для тестирования HTTP endpoints
async function testHTTPEndpoints() {
    console.log('🌐 Тестирование HTTP endpoints...\n');

    const endpoints = [
        'http://localhost:3000/api/events',
        'http://localhost:3000/api/events?active_only=true',
        'http://localhost:3000/api/visitors/events/active'
    ];

    for (const endpoint of endpoints) {
        try {
            console.log(`📡 Тестирование: ${endpoint}`);

            const response = await fetch(endpoint);
            console.log(`   Статус: ${response.status} ${response.statusText}`);

            if (response.ok) {
                const data = await response.json();
                console.log(`   Данные: ${JSON.stringify(data, null, 2).substring(0, 200)}...`);

                if (data.events && Array.isArray(data.events)) {
                    console.log(`   ✅ Найдено событий: ${data.events.length}`);
                } else if (data.success && data.events) {
                    console.log(`   ✅ Найдено событий: ${data.events.length}`);
                } else {
                    console.log(`   ⚠️  Неожиданный формат данных`);
                }
            } else {
                const errorText = await response.text();
                console.log(`   ❌ Ошибка: ${errorText.substring(0, 100)}`);
            }
        } catch (err) {
            console.log(`   ❌ Исключение: ${err.message}`);
        }
        console.log('');
    }
}

// Функция для проверки базы данных
async function testDatabase() {
    console.log('🗄️ Тестирование базы данных...\n');

    const pool = new Pool(dbConfig);

    try {
        // Проверяем подключение
        await pool.query('SELECT 1');
        console.log('✅ Подключение к базе данных установлено');

        // Проверяем таблицы
        const tables = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name IN ('events', 'visitors', 'users', 'scans')
            ORDER BY table_name
        `);

        console.log('📋 Найденные таблицы:');
        tables.rows.forEach(row => {
            console.log(`   ✅ ${row.table_name}`);
        });

        // Проверяем события
        const eventsCount = await pool.query('SELECT COUNT(*) as count FROM events');
        console.log(`\n🎯 Всего событий в базе: ${eventsCount.rows[0].count}`);

        if (parseInt(eventsCount.rows[0].count) > 0) {
            const activeEvents = await pool.query(`
                SELECT id, name, status, start_date, end_date 
                FROM events 
                WHERE status = 'active' AND end_date >= CURRENT_DATE
                ORDER BY start_date
            `);

            console.log(`📅 Активных событий: ${activeEvents.rows.length}`);
            activeEvents.rows.forEach((event, i) => {
                console.log(`   ${i + 1}. ${event.name} (${event.start_date} - ${event.end_date})`);
            });
        } else {
            console.log('⚠️ События в базе отсутствуют');

            // Создаем тестовые события
            console.log('\n🔧 Создание тестовых событий...');
            const testEvents = [
                {
                    name: 'IT-Конференция 2024',
                    description: 'Ежегодная конференция по информационным технологиям',
                    start_date: '2024-12-01',
                    end_date: '2024-12-31',
                    location: 'Москва, ЦВК "Экспоцентр"'
                },
                {
                    name: 'Выставка инноваций',
                    description: 'Выставка новых технологий и стартапов',
                    start_date: '2024-11-15',
                    end_date: '2024-12-15',
                    location: 'СПб, Ленэкспо'
                }
            ];

            for (const event of testEvents) {
                try {
                    await pool.query(`
                        INSERT INTO events (name, description, start_date, end_date, location, created_by)
                        VALUES ($1, $2, $3, $4, $5, 1)
                    `, [event.name, event.description, event.start_date, event.end_date, event.location]);

                    console.log(`   ✅ Создано: ${event.name}`);
                } catch (err) {
                    console.log(`   ❌ Ошибка создания ${event.name}: ${err.message}`);
                }
            }
        }

        // Проверяем посетителей
        const visitorsCount = await pool.query('SELECT COUNT(*) as count FROM visitors');
        console.log(`\n👥 Всего посетителей: ${visitorsCount.rows[0].count}`);

        const visitorsWithEvents = await pool.query(`
            SELECT COUNT(*) as count FROM visitors WHERE event_id IS NOT NULL
        `);
        console.log(`🔗 Посетителей с событиями: ${visitorsWithEvents.rows[0].count}`);

    } catch (err) {
        console.error('❌ Ошибка базы данных:', err.message);
    } finally {
        await pool.end();
    }
}

// Функция для полной диагностики
async function fullDiagnostic() {
    console.log('🔍 ПОЛНАЯ ДИАГНОСТИКА СИСТЕМЫ СОБЫТИЙ');
    console.log('=====================================\n');

    try {
        await testDatabase();
        console.log('\n');
        await testHTTPEndpoints();

        console.log('🎯 РЕКОМЕНДАЦИИ:');
        console.log('================');
        console.log('1. Убедитесь, что сервер запущен на порту 3000');
        console.log('2. Проверьте, что база данных содержит события');
        console.log('3. Убедитесь, что endpoint /api/visitors/events/active возвращает данные');
        console.log('4. Откройте браузер и проверьте консоль разработчика');
        console.log('5. Используйте debugApp.testEventsAPI() в консоли браузера');

    } catch (err) {
        console.error('❌ Критическая ошибка диагностики:', err);
    }
}

// Тест только базы данных
async function testOnlyDatabase() {
    await testDatabase();
}

// Тест только HTTP
async function testOnlyHTTP() {
    await testHTTPEndpoints();
}

// Главная функция
async function main() {
    const command = process.argv[2];

    switch (command) {
        case 'db':
            await testOnlyDatabase();
            break;
        case 'http':
            await testOnlyHTTP();
            break;
        case 'full':
        default:
            await fullDiagnostic();
            break;
    }
}

// Если файл запускается напрямую
if (require.main === module) {
    // Простая проверка доступности fetch
    if (typeof fetch === 'undefined') {
        global.fetch = require('node-fetch');
    }

    main().catch(console.error);
}

module.exports = { testDatabase, testHTTPEndpoints, fullDiagnostic };