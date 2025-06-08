// scripts/migrate-to-events.js
// Скрипт для миграции существующей системы к поддержке событий

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

async function runMigration() {
    console.log('🔄 Начинаем миграцию базы данных для поддержки событий...\n');

    const pool = new Pool(dbConfig);

    try {
        // Проверяем подключение
        await pool.query('SELECT 1');
        console.log('✅ Подключение к базе данных установлено');

        // Проверяем, существует ли уже таблица events
        const eventsTableCheck = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'events'
            );
        `);

        if (eventsTableCheck.rows[0].exists) {
            console.log('ℹ️  Таблица events уже существует, пропускаем создание...');
        } else {
            console.log('📋 Создание таблицы events...');
            await pool.query(`
                CREATE TABLE events (
                    id SERIAL PRIMARY KEY,
                    event_uuid UUID DEFAULT uuid_generate_v4() UNIQUE NOT NULL,
                    name VARCHAR(200) NOT NULL,
                    description TEXT,
                    start_date DATE NOT NULL,
                    end_date DATE NOT NULL,
                    location VARCHAR(300),
                    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'completed', 'cancelled')),
                    max_participants INTEGER DEFAULT NULL,
                    registration_required BOOLEAN DEFAULT false,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    created_by INTEGER REFERENCES users(id),
                    updated_by INTEGER REFERENCES users(id)
                );
            `);
            console.log('✅ Таблица events создана');
        }

        // Проверяем, есть ли уже колонка event_id в таблице visitors
        const eventIdColumnCheck = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.columns 
                WHERE table_name = 'visitors' 
                AND column_name = 'event_id'
            );
        `);

        if (eventIdColumnCheck.rows[0].exists) {
            console.log('ℹ️  Колонка event_id уже существует в таблице visitors');
        } else {
            console.log('📋 Добавление колонки event_id в таблицу visitors...');
            await pool.query(`
                ALTER TABLE visitors ADD COLUMN event_id INTEGER REFERENCES events(id);
            `);
            console.log('✅ Колонка event_id добавлена');
        }

        // Создаем индексы если их нет
        console.log('📋 Создание индексов...');

        const indexQueries = [
            'CREATE INDEX IF NOT EXISTS idx_events_dates ON events(start_date, end_date);',
            'CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);',
            'CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);',
            'CREATE INDEX IF NOT EXISTS idx_visitors_event_id ON visitors(event_id);'
        ];

        for (const indexQuery of indexQueries) {
            await pool.query(indexQuery);
        }
        console.log('✅ Индексы созданы');

        // Создаем триггер для events
        console.log('📋 Создание триггера для events...');
        await pool.query(`
            DROP TRIGGER IF EXISTS update_events_updated_at ON events;
            CREATE TRIGGER update_events_updated_at
                BEFORE UPDATE ON events
                FOR EACH ROW
                EXECUTE FUNCTION update_updated_at_column();
        `);
        console.log('✅ Триггер создан');

        // Создаем представления
        console.log('📋 Создание представлений...');
        await pool.query(`
            DROP VIEW IF EXISTS events_stats;
            CREATE VIEW events_stats AS
            SELECT
                e.id,
                e.name,
                e.start_date,
                e.end_date,
                e.status,
                COUNT(v.id) as total_visitors,
                COUNT(CASE WHEN v.status = 'active' THEN 1 END) as active_visitors,
                COUNT(CASE WHEN v.status = 'blocked' THEN 1 END) as blocked_visitors,
                COUNT(s.id) as total_scans,
                COUNT(CASE WHEN s.scan_date = CURRENT_DATE THEN 1 END) as today_scans,
                COUNT(DISTINCT CASE WHEN s.scan_type = 'first' THEN s.visitor_id END) as unique_visitors_scanned
            FROM events e
            LEFT JOIN visitors v ON e.id = v.event_id
            LEFT JOIN scans s ON v.id = s.visitor_id
            GROUP BY e.id, e.name, e.start_date, e.end_date, e.status;
        `);
        console.log('✅ Представления созданы');

        // Создаем функцию для статистики событий
        console.log('📋 Создание функций...');
        await pool.query(`
            CREATE OR REPLACE FUNCTION get_event_stats(event_id_param INTEGER)
            RETURNS TABLE (
                total_visitors BIGINT,
                active_visitors BIGINT,
                blocked_visitors BIGINT,
                total_scans BIGINT,
                today_scans BIGINT,
                unique_visitors_scanned BIGINT,
                daily_scans JSONB
            ) AS $$
            BEGIN
                RETURN QUERY
                SELECT 
                    COUNT(v.id) as total_visitors,
                    COUNT(CASE WHEN v.status = 'active' THEN 1 END) as active_visitors,
                    COUNT(CASE WHEN v.status = 'blocked' THEN 1 END) as blocked_visitors,
                    COUNT(s.id) as total_scans,
                    COUNT(CASE WHEN s.scan_date = CURRENT_DATE THEN 1 END) as today_scans,
                    COUNT(DISTINCT CASE WHEN s.scan_type = 'first' THEN s.visitor_id END) as unique_visitors_scanned,
                    COALESCE(
                        jsonb_agg(
                            jsonb_build_object(
                                'date', s.scan_date,
                                'scans', COUNT(s.id)
                            ) ORDER BY s.scan_date
                        ) FILTER (WHERE s.scan_date IS NOT NULL),
                        '[]'::jsonb
                    ) as daily_scans
                FROM visitors v
                LEFT JOIN scans s ON v.id = s.visitor_id
                WHERE v.event_id = event_id_param;
            END;
            $$ LANGUAGE plpgsql;
        `);
        console.log('✅ Функции созданы');

        // Проверяем наличие событий
        const eventsCount = await pool.query('SELECT COUNT(*) as count FROM events');

        if (parseInt(eventsCount.rows[0].count) === 0) {
            console.log('📋 Создание тестовых событий...');

            await pool.query(`
                INSERT INTO events (name, description, start_date, end_date, location, created_by) VALUES
                ('Конференция IT-2024', 'Ежегодная IT конференция', '2024-06-15', '2024-06-17', 'Москва, ЦВК "Экспоцентр"', 1),
                ('Выставка инноваций', 'Выставка новых технологий', '2024-07-01', '2024-07-03', 'СПб, Ленэкспо', 1),
                ('Семинар по безопасности', 'Обучающий семинар', '2024-06-20', '2024-06-20', 'Онлайн', 1)
            `);
            console.log('✅ Тестовые события созданы');
        }

        // Обновляем существующих посетителей без event_id
        const orphanVisitors = await pool.query('SELECT COUNT(*) as count FROM visitors WHERE event_id IS NULL');

        if (parseInt(orphanVisitors.rows[0].count) > 0) {
            console.log(`📋 Найдено ${orphanVisitors.rows[0].count} посетителей без привязки к событию`);

            // Получаем первое доступное событие
            const firstEvent = await pool.query('SELECT id FROM events ORDER BY id LIMIT 1');

            if (firstEvent.rows.length > 0) {
                await pool.query(
                    'UPDATE visitors SET event_id = $1 WHERE event_id IS NULL',
                    [firstEvent.rows[0].id]
                );
                console.log('✅ Посетители привязаны к первому событию');
            }
        }

        // Проверяем результаты миграции
        console.log('\n📊 Результаты миграции:');

        const finalStats = await pool.query(`
            SELECT 
                (SELECT COUNT(*) FROM events) as events_count,
                (SELECT COUNT(*) FROM visitors) as visitors_count,
                (SELECT COUNT(*) FROM visitors WHERE event_id IS NOT NULL) as visitors_with_events,
                (SELECT COUNT(*) FROM scans) as scans_count
        `);

        const stats = finalStats.rows[0];
        console.log(`   🎯 События: ${stats.events_count}`);
        console.log(`   👥 Посетители: ${stats.visitors_count}`);
        console.log(`   🔗 Посетители с событиями: ${stats.visitors_with_events}`);
        console.log(`   📱 Сканирования: ${stats.scans_count}`);

        // Проверяем представления
        const viewTest = await pool.query('SELECT * FROM events_stats LIMIT 1');
        console.log(`   📈 Представление events_stats: ${viewTest.rows.length > 0 ? 'работает' : 'проблемы'}`);

        console.log('\n🎉 Миграция успешно завершена!');
        console.log('\n💡 Что изменилось:');
        console.log('   ✨ Добавлена поддержка событий');
        console.log('   ✨ Посетители теперь привязываются к событиям');
        console.log('   ✨ Новая статистика по событиям');
        console.log('   ✨ API для управления событиями');

        console.log('\n🚀 Обновите свой сервер:');
        console.log('   1. Остановите текущий сервер');
        console.log('   2. Добавьте новый файл routes/events.js');
        console.log('   3. Обновите server.js');
        console.log('   4. Обновите public/index.html');
        console.log('   5. Запустите сервер заново');

    } catch (err) {
        console.error('❌ Ошибка миграции:', err);

        if (err.code === 'ECONNREFUSED') {
            console.error('💡 Убедитесь что база данных запущена');
        } else if (err.code === '42P01') {
            console.error('💡 Проблема с таблицами. Возможно нужно запустить init.sql сначала');
        }

        process.exit(1);
    } finally {
        await pool.end();
    }
}

// Функция для отката миграции
async function rollbackMigration() {
    console.log('🔄 Откат миграции...\n');

    const pool = new Pool(dbConfig);

    try {
        await pool.query('SELECT 1');
        console.log('✅ Подключение к базе данных установлено');

        // Удаляем колонку event_id из visitors (если нет данных)
        const visitorsWithEvents = await pool.query('SELECT COUNT(*) as count FROM visitors WHERE event_id IS NOT NULL');

        if (parseInt(visitorsWithEvents.rows[0].count) === 0) {
            console.log('📋 Удаление колонки event_id из таблицы visitors...');
            await pool.query('ALTER TABLE visitors DROP COLUMN IF EXISTS event_id');
            console.log('✅ Колонка event_id удалена');
        } else {
            console.log('⚠️  Найдены посетители с привязкой к событиям. Колонка event_id не удалена.');
        }

        // Удаляем представления и функции
        console.log('📋 Удаление представлений и функций...');
        await pool.query('DROP VIEW IF EXISTS events_stats');
        await pool.query('DROP FUNCTION IF EXISTS get_event_stats');
        console.log('✅ Представления и функции удалены');

        // Удаляем таблицу events (если нет данных)
        const eventsCount = await pool.query('SELECT COUNT(*) as count FROM events');

        if (parseInt(eventsCount.rows[0].count) === 0) {
            console.log('📋 Удаление таблицы events...');
            await pool.query('DROP TABLE IF EXISTS events CASCADE');
            console.log('✅ Таблица events удалена');
        } else {
            console.log('⚠️  Найдены события в базе. Таблица events не удалена.');
        }

        console.log('\n✅ Откат миграции завершен');

    } catch (err) {
        console.error('❌ Ошибка отката:', err);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

// Главная функция
async function main() {
    const command = process.argv[2];

    switch (command) {
        case 'migrate':
        case 'up':
            await runMigration();
            break;
        case 'rollback':
        case 'down':
            const confirmed = process.argv[3] === '--confirm';
            if (!confirmed) {
                console.log('⚠️  Откат миграции удалит все данные о событиях!');
                console.log('Используйте: node migrate-to-events.js rollback --confirm');
                return;
            }
            await rollbackMigration();
            break;
        case 'status':
            await checkMigrationStatus();
            break;
        default:
            console.log('🔧 Скрипт миграции для поддержки событий');
            console.log('==========================================');
            console.log('Использование:');
            console.log('  node migrate-to-events.js migrate     # Применить миграцию');
            console.log('  node migrate-to-events.js rollback --confirm # Откатить миграцию');
            console.log('  node migrate-to-events.js status      # Проверить статус');
            console.log('');
            console.log('Миграция добавляет:');
            console.log('  - Таблицу events');
            console.log('  - Колонку event_id в visitors');
            console.log('  - Представления и функции статистики');
            console.log('  - Тестовые события');
    }
}

// Проверка статуса миграции
async function checkMigrationStatus() {
    const pool = new Pool(dbConfig);

    try {
        await pool.query('SELECT 1');
        console.log('📊 Статус миграции базы данных:\n');

        // Проверяем таблицу events
        const eventsTable = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'events'
            );
        `);
        console.log(`📋 Таблица events: ${eventsTable.rows[0].exists ? '✅ существует' : '❌ отсутствует'}`);

        // Проверяем колонку event_id
        const eventIdColumn = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.columns 
                WHERE table_name = 'visitors' 
                AND column_name = 'event_id'
            );
        `);
        console.log(`🔗 Колонка event_id: ${eventIdColumn.rows[0].exists ? '✅ существует' : '❌ отсутствует'}`);

        // Проверяем представления
        const eventsStatsView = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.views 
                WHERE table_schema = 'public' 
                AND table_name = 'events_stats'
            );
        `);
        console.log(`📈 Представление events_stats: ${eventsStatsView.rows[0].exists ? '✅ существует' : '❌ отсутствует'}`);

        // Считаем данные
        if (eventsTable.rows[0].exists) {
            const counts = await pool.query(`
                SELECT 
                    (SELECT COUNT(*) FROM events) as events,
                    (SELECT COUNT(*) FROM visitors WHERE event_id IS NOT NULL) as visitors_with_events
            `);
            console.log(`🎯 События в базе: ${counts.rows[0].events}`);
            console.log(`👥 Посетители с событиями: ${counts.rows[0].visitors_with_events}`);
        }

        const migrationComplete = eventsTable.rows[0].exists && eventIdColumn.rows[0].exists && eventsStatsView.rows[0].exists;
        console.log(`\n🏁 Статус миграции: ${migrationComplete ? '✅ ЗАВЕРШЕНА' : '❌ НЕ ЗАВЕРШЕНА'}`);

    } catch (err) {
        console.error('❌ Ошибка проверки статуса:', err);
    } finally {
        await pool.end();
    }
}

// Запускаем только если файл выполняется напрямую
if (require.main === module) {
    main().catch(console.error);
}

module.exports = { runMigration, rollbackMigration, checkMigrationStatus };