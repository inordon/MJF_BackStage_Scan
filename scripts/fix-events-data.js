// scripts/fix-events-data.js
// Скрипт для создания активных событий с правильными датами

const { Pool } = require('pg');

const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'visitor_system',
    user: process.env.DB_USER || 'visitor_admin',
    password: process.env.DB_PASSWORD || 'secure_password_123'
};

async function fixEventsData() {
    console.log('🔧 ИСПРАВЛЕНИЕ ДАННЫХ СОБЫТИЙ');
    console.log('=============================\n');

    const pool = new Pool(dbConfig);

    try {
        // 1. Проверяем текущее состояние
        console.log('📊 Текущее состояние событий:');

        const allEvents = await pool.query('SELECT COUNT(*) as total FROM events');
        console.log(`   Всего событий: ${allEvents.rows[0].total}`);

        const activeEvents = await pool.query(`
            SELECT COUNT(*) as active FROM events 
            WHERE status = 'active' AND end_date >= CURRENT_DATE
        `);
        console.log(`   Активных событий: ${activeEvents.rows[0].active}`);
        console.log('');

        // 2. Показываем все события
        const existingEvents = await pool.query(`
            SELECT id, name, status, start_date, end_date, 
                   CASE WHEN end_date >= CURRENT_DATE THEN 'будущее' ELSE 'прошлое' END as date_status
            FROM events 
            ORDER BY created_at DESC
        `);

        if (existingEvents.rows.length > 0) {
            console.log('📋 Существующие события:');
            existingEvents.rows.forEach((event, i) => {
                const statusIcon = event.status === 'active' ? '✅' : '❌';
                const dateIcon = event.date_status === 'будущее' ? '📅' : '⏰';
                console.log(`   ${i + 1}. ${statusIcon}${dateIcon} "${event.name}"`);
                console.log(`      Статус: ${event.status}, Даты: ${event.start_date} - ${event.end_date} (${event.date_status})`);
            });
            console.log('');
        }

        // 3. Исправляем существующие события
        console.log('🔧 Исправление существующих событий...');
        const updateResult = await pool.query(`
            UPDATE events 
            SET 
                status = 'active',
                end_date = CASE 
                    WHEN end_date < CURRENT_DATE THEN CURRENT_DATE + INTERVAL '6 months'
                    ELSE end_date
                END,
                updated_at = CURRENT_TIMESTAMP
            WHERE status != 'active' OR end_date < CURRENT_DATE
            RETURNING id, name, end_date;
        `);

        if (updateResult.rows.length > 0) {
            console.log(`✅ Исправлено ${updateResult.rows.length} событий:`);
            updateResult.rows.forEach(event => {
                console.log(`   - "${event.name}" (новая дата: ${event.end_date})`);
            });
        } else {
            console.log('ℹ️ Все существующие события уже корректны');
        }
        console.log('');

        // 4. Создаем новые события, если их мало
        const activeCount = await pool.query(`
            SELECT COUNT(*) as count FROM events 
            WHERE status = 'active' AND end_date >= CURRENT_DATE
        `);

        if (parseInt(activeCount.rows[0].count) < 3) {
            console.log('➕ Создание дополнительных тестовых событий...');

            const newEvents = [
                {
                    name: 'IT-Конференция 2025',
                    description: 'Главная конференция по информационным технологиям',
                    start_date: '2024-12-01',
                    end_date: '2025-12-31',
                    location: 'Москва, ЦВК "Экспоцентр"',
                    status: 'active'
                },
                {
                    name: 'Выставка Инноваций',
                    description: 'Международная выставка новых технологий',
                    start_date: '2024-11-15',
                    end_date: '2025-11-30',
                    location: 'Санкт-Петербург, ЛенЭкспо',
                    status: 'active'
                },
                {
                    name: 'Семинар по Кибербезопасности',
                    description: 'Обучающий семинар для IT-специалистов',
                    start_date: '2024-11-01',
                    end_date: '2025-10-31',
                    location: 'Онлайн',
                    status: 'active'
                },
                {
                    name: 'Форум Разработчиков',
                    description: 'Встреча программистов и архитекторов',
                    start_date: '2024-12-15',
                    end_date: '2025-06-30',
                    location: 'Екатеринбург',
                    status: 'active'
                }
            ];

            let created = 0;
            for (const event of newEvents) {
                try {
                    // Проверяем, не существует ли уже событие с таким названием
                    const existing = await pool.query(
                        'SELECT id FROM events WHERE name = $1',
                        [event.name]
                    );

                    if (existing.rows.length === 0) {
                        await pool.query(`
                            INSERT INTO events (name, description, start_date, end_date, location, status, created_by)
                            VALUES ($1, $2, $3, $4, $5, $6, 1)
                        `, [event.name, event.description, event.start_date, event.end_date, event.location, event.status]);

                        console.log(`   ✅ Создано: "${event.name}"`);
                        created++;
                    } else {
                        console.log(`   ℹ️ Уже существует: "${event.name}"`);
                    }
                } catch (err) {
                    console.log(`   ❌ Ошибка создания "${event.name}": ${err.message}`);
                }
            }

            console.log(`✅ Создано ${created} новых событий\n`);
        }

        // 5. Финальная проверка
        console.log('🎯 ФИНАЛЬНАЯ ПРОВЕРКА:');

        const finalCheck = await pool.query(`
            SELECT id, name, status, start_date, end_date
            FROM events 
            WHERE status = 'active' AND end_date >= CURRENT_DATE
            ORDER BY start_date
        `);

        if (finalCheck.rows.length > 0) {
            console.log(`✅ Активных событий для фильтра: ${finalCheck.rows.length}`);
            finalCheck.rows.forEach((event, i) => {
                console.log(`   ${i + 1}. "${event.name}" (${event.start_date} - ${event.end_date})`);
            });
        } else {
            console.log('❌ Все еще нет активных событий!');
        }
        console.log('');

        // 6. Тестируем SQL запрос из API
        console.log('🧪 Тестируем точный SQL запрос из API:');
        const apiTestQuery = `
            SELECT id, name, description, start_date, end_date, location, status
            FROM events
            WHERE status = 'active' AND end_date >= CURRENT_DATE
            ORDER BY start_date ASC
        `;

        const apiTestResult = await pool.query(apiTestQuery);
        console.log(`📊 API должен вернуть ${apiTestResult.rows.length} событий:`);

        if (apiTestResult.rows.length > 0) {
            apiTestResult.rows.forEach((event, i) => {
                console.log(`   ${i + 1}. ID: ${event.id}, "${event.name}" (${event.location || 'без места'})`);
            });
        } else {
            console.log('   ❌ API все еще не вернет события');
        }
        console.log('');

        console.log('🚀 СЛЕДУЮЩИЕ ШАГИ:');
        console.log('1. Обновите страницу в браузере');
        console.log('2. Проверьте API: curl http://localhost:3000/api/visitors/events/active');
        console.log('3. В браузере выполните: debugApp.forceUpdateFilter()');
        console.log('4. Перейдите на вкладку "Посетители" и проверьте фильтр событий');

    } catch (err) {
        console.error('❌ Ошибка исправления данных:', err);
    } finally {
        await pool.end();
    }
}

async function testAPIResponse() {
    console.log('🌐 Тестирование API после исправлений...\n');

    // Проверяем доступность fetch
    if (typeof fetch === 'undefined') {
        try {
            global.fetch = require('node-fetch');
        } catch (err) {
            console.log('❌ Установите node-fetch: npm install node-fetch');
            return;
        }
    }

    const endpoints = [
        'http://localhost:3000/api/events',
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
                        console.log(`   📋 События:`);
                        data.events.slice(0, 3).forEach((event, i) => {
                            console.log(`      ${i + 1}. "${event.name}"`);
                        });
                        if (data.events.length > 3) {
                            console.log(`      ... и еще ${data.events.length - 3}`);
                        }
                    } else {
                        console.log('   ⚠️ Массив событий пуст');
                    }
                } else {
                    console.log(`   ⚠️ Нет поля events в ответе`);
                    console.log(`   📋 Структура:`, Object.keys(data));
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

async function main() {
    const command = process.argv[2];

    switch (command) {
        case 'test':
            await testAPIResponse();
            break;
        case 'fix':
        default:
            await fixEventsData();
            console.log('\n');
            await testAPIResponse();
            break;
    }
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = { fixEventsData, testAPIResponse };