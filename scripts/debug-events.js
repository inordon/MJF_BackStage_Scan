// scripts/debug-events.js
// Скрипт для диагностики проблем с событиями

const { Pool } = require('pg');

const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'visitor_system',
    user: process.env.DB_USER || 'visitor_admin',
    password: process.env.DB_PASSWORD || 'secure_password_123'
};

async function debugEvents() {
    console.log('🔍 ДИАГНОСТИКА СОБЫТИЙ');
    console.log('=====================\n');

    const pool = new Pool(dbConfig);

    try {
        // 1. Проверяем подключение к БД
        await pool.query('SELECT 1');
        console.log('✅ Подключение к базе данных работает\n');

        // 2. Проверяем существование таблицы events
        const tableExists = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'events'
            );
        `);

        if (!tableExists.rows[0].exists) {
            console.log('❌ Таблица events не существует!');
            console.log('Запустите миграцию: node scripts/migrate-to-events.js migrate');
            return;
        }
        console.log('✅ Таблица events существует\n');

        // 3. Проверяем структуру таблицы events
        const structure = await pool.query(`
            SELECT column_name, data_type, is_nullable 
            FROM information_schema.columns 
            WHERE table_name = 'events' 
            ORDER BY ordinal_position;
        `);

        console.log('📋 Структура таблицы events:');
        structure.rows.forEach(col => {
            console.log(`   ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? '(NOT NULL)' : ''}`);
        });
        console.log('');

        // 4. Проверяем общее количество событий
        const totalEvents = await pool.query('SELECT COUNT(*) as count FROM events');
        console.log(`📊 Всего событий в базе: ${totalEvents.rows[0].count}\n`);

        if (parseInt(totalEvents.rows[0].count) === 0) {
            console.log('⚠️ В базе нет событий. Создаем тестовые...\n');
            await createTestEvents(pool);
        }

        // 5. Показываем все события
        const allEvents = await pool.query(`
            SELECT id, name, status, start_date, end_date, created_at 
            FROM events 
            ORDER BY created_at DESC
        `);

        console.log('📋 Все события в базе:');
        if (allEvents.rows.length === 0) {
            console.log('   (нет событий)');
        } else {
            allEvents.rows.forEach((event, i) => {
                console.log(`   ${i + 1}. ID: ${event.id}, Название: "${event.name}"`);
                console.log(`      Статус: ${event.status}, Даты: ${event.start_date} - ${event.end_date}`);
                console.log(`      Создано: ${event.created_at}`);
                console.log('');
            });
        }

        // 6. Проверяем активные события
        const activeEvents = await pool.query(`
            SELECT id, name, status, start_date, end_date 
            FROM events 
            WHERE status = 'active' AND end_date >= CURRENT_DATE
            ORDER BY start_date
        `);

        console.log('🎯 Активные события (статус = active, дата окончания >= сегодня):');
        if (activeEvents.rows.length === 0) {
            console.log('   ❌ Нет активных событий!');

            // Проверяем причины
            const inactiveCount = await pool.query(`SELECT COUNT(*) as count FROM events WHERE status != 'active'`);
            const expiredCount = await pool.query(`SELECT COUNT(*) as count FROM events WHERE end_date < CURRENT_DATE`);

            console.log(`   - События с неактивным статусом: ${inactiveCount.rows[0].count}`);
            console.log(`   - События с истекшей датой: ${expiredCount.rows[0].count}`);

        } else {
            activeEvents.rows.forEach((event, i) => {
                console.log(`   ${i + 1}. ID: ${event.id}, "${event.name}" (${event.start_date} - ${event.end_date})`);
            });
        }
        console.log('');

        // 7. Тестируем SQL запрос, который использует API
        console.log('🧪 Тестируем SQL запрос из API /api/visitors/events/active:');
        const apiQuery = `
            SELECT id, name, description, start_date, end_date, location, status
            FROM events
            WHERE status = 'active' AND end_date >= CURRENT_DATE
            ORDER BY start_date ASC
        `;

        const apiResult = await pool.query(apiQuery);
        console.log(`   Результат: ${apiResult.rows.length} событий`);

        if (apiResult.rows.length > 0) {
            console.log('   События из API запроса:');
            apiResult.rows.forEach((event, i) => {
                console.log(`     ${i + 1}. ID: ${event.id}, "${event.name}"`);
            });
        } else {
            console.log('   ❌ API запрос не возвращает события');
        }
        console.log('');

        // 8. Проверяем права доступа
        console.log('🔐 Проверяем права доступа к таблице events:');
        try {
            await pool.query('SELECT * FROM events LIMIT 1');
            console.log('   ✅ Права на чтение есть');
        } catch (err) {
            console.log('   ❌ Нет прав на чтение:', err.message);
        }

        try {
            await pool.query(`INSERT INTO events (name, start_date, end_date) VALUES ('test', CURRENT_DATE, CURRENT_DATE + INTERVAL '1 day')`);
            await pool.query(`DELETE FROM events WHERE name = 'test'`);
            console.log('   ✅ Права на запись есть');
        } catch (err) {
            console.log('   ❌ Нет прав на запись:', err.message);
        }
        console.log('');

        // 9. Показываем рекомендации
        console.log('💡 РЕКОМЕНДАЦИИ:');
        console.log('===============');

        if (activeEvents.rows.length === 0) {
            console.log('1. ❌ Нет активных событий для отображения в фильтре');
            console.log('   Решение: Создайте события со статусом "active" и датой окончания в будущем');
            console.log('   Команда: node scripts/debug-events.js create');
        } else {
            console.log('1. ✅ Активные события есть в базе');
        }

        console.log('2. 🌐 Проверьте HTTP API:');
        console.log('   curl http://localhost:3000/api/events');
        console.log('   curl http://localhost:3000/api/visitors/events/active');

        console.log('3. 🔧 В браузере выполните:');
        console.log('   debugApp.testEventsAPI()');
        console.log('   debugApp.diagnose()');

    } catch (err) {
        console.error('❌ Ошибка диагностики:', err);
    } finally {
        await pool.end();
    }
}

async function createTestEvents(pool) {
    console.log('🔧 Создание тестовых событий...');

    const testEvents = [
        {
            name: 'IT-Конференция 2025',
            description: 'Ежегодная конференция по информационным технологиям',
            start_date: '2024-12-01',
            end_date: '2025-03-31', // Дата в будущем
            location: 'Москва, ЦВК "Экспоцентр"',
            status: 'active'
        },
        {
            name: 'Выставка инноваций 2025',
            description: 'Выставка новых технологий и стартапов',
            start_date: '2024-11-15',
            end_date: '2025-02-28', // Дата в будущем
            location: 'СПб, Ленэкспо',
            status: 'active'
        },
        {
            name: 'Семинар по безопасности',
            description: 'Обучающий семинар по кибербезопасности',
            start_date: '2024-11-01',
            end_date: '2025-01-31', // Дата в будущем
            location: 'Онлайн',
            status: 'active'
        }
    ];

    let created = 0;
    for (const event of testEvents) {
        try {
            await pool.query(`
                INSERT INTO events (name, description, start_date, end_date, location, status, created_by)
                VALUES ($1, $2, $3, $4, $5, $6, 1)
            `, [event.name, event.description, event.start_date, event.end_date, event.location, event.status]);

            console.log(`   ✅ Создано: ${event.name}`);
            created++;
        } catch (err) {
            if (err.code === '23505') { // Unique constraint
                console.log(`   ⚠️ Уже существует: ${event.name}`);
            } else {
                console.log(`   ❌ Ошибка создания ${event.name}: ${err.message}`);
            }
        }
    }

    console.log(`✅ Создано ${created} новых событий\n`);
}

async function fixEventDates(pool) {
    console.log('🔧 Исправление дат событий...');

    // Обновляем все события, чтобы они были активными и в будущем
    const result = await pool.query(`
        UPDATE events 
        SET 
            end_date = CURRENT_DATE + INTERVAL '3 months',
            status = 'active',
            updated_at = CURRENT_TIMESTAMP
        WHERE end_date < CURRENT_DATE OR status != 'active'
        RETURNING id, name, end_date;
    `);

    console.log(`✅ Обновлено ${result.rows.length} событий:`);
    result.rows.forEach(event => {
        console.log(`   - ${event.name} (новая дата окончания: ${event.end_date})`);
    });
}

async function testHTTPEndpoints() {
    console.log('🌐 Тестирование HTTP endpoints...\n');

    // Проверяем доступность fetch
    if (typeof fetch === 'undefined') {
        global.fetch = require('node-fetch');
    }

    const endpoints = [
        'http://localhost:3000/api/events',
        'http://localhost:3000/api/events?active_only=true',
        'http://localhost:3000/api/visitors/events/active'
    ];

    for (const url of endpoints) {
        try {
            console.log(`📡 Тестируем: ${url}`);
            const response = await fetch(url);

            console.log(`   Статус: ${response.status} ${response.statusText}`);

            if (response.ok) {
                const data = await response.json();

                if (data.events) {
                    console.log(`   ✅ Событий в ответе: ${data.events.length}`);
                    if (data.events.length > 0) {
                        console.log(`   📋 Первое событие: "${data.events[0].name}"`);
                    }
                } else if (data.success && data.events) {
                    console.log(`   ✅ Событий в ответе: ${data.events.length}`);
                } else {
                    console.log(`   ⚠️ Неожиданная структура ответа:`, Object.keys(data));
                }
            } else {
                const errorText = await response.text();
                console.log(`   ❌ Ошибка: ${errorText.substring(0, 200)}`);
            }
        } catch (err) {
            console.log(`   ❌ Исключение: ${err.message}`);
        }
        console.log('');
    }
}

async function main() {
    const command = process.argv[2];

    switch (command) {
        case 'create':
            const pool1 = new Pool(dbConfig);
            try {
                await createTestEvents(pool1);
            } finally {
                await pool1.end();
            }
            break;

        case 'fix':
            const pool2 = new Pool(dbConfig);
            try {
                await fixEventDates(pool2);
            } finally {
                await pool2.end();
            }
            break;

        case 'http':
            await testHTTPEndpoints();
            break;

        case 'full':
            await debugEvents();
            console.log('\n');
            await testHTTPEndpoints();
            break;

        default:
            await debugEvents();
            break;
    }
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = { debugEvents, createTestEvents, testHTTPEndpoints };