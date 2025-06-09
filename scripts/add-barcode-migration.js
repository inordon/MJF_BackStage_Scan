// scripts/add-barcode-migration.js
// Скрипт для добавления поля barcode в таблицу visitors

const { Pool } = require('pg');

// Конфигурация подключения к базе данных
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'visitor_system',
    user: process.env.DB_USER || 'visitor_admin',
    password: process.env.DB_PASSWORD || 'secure_password_123'
};

// Функция генерации штрихкода
function generateBarcode(index, date) {
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD
    const indexStr = String(index).padStart(3, '0'); // 001, 002, etc.
    return `VIS${dateStr}${indexStr}`;
}

async function addBarcodeField() {
    console.log('🔧 Добавление поля barcode в таблицу visitors...\n');

    const pool = new Pool(dbConfig);

    try {
        // Проверяем подключение
        await pool.query('SELECT 1');
        console.log('✅ Подключение к базе данных установлено');

        // Проверяем, существует ли уже колонка barcode
        const columnCheck = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.columns 
                WHERE table_name = 'visitors' 
                AND column_name = 'barcode'
            );
        `);

        if (columnCheck.rows[0].exists) {
            console.log('ℹ️  Колонка barcode уже существует');
        } else {
            console.log('📋 Добавление колонки barcode...');

            // Добавляем колонку barcode
            await pool.query(`
                ALTER TABLE visitors ADD COLUMN barcode VARCHAR(100) UNIQUE;
            `);

            console.log('✅ Колонка barcode добавлена');
        }

        // Создаем индекс для быстрого поиска по штрихкоду
        console.log('📋 Создание индекса для штрихкода...');
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_visitors_barcode ON visitors(barcode);
        `);
        console.log('✅ Индекс создан');

        // Добавляем комментарий
        await pool.query(`
            COMMENT ON COLUMN visitors.barcode IS 'Штрихкод посетителя для генерации QR кода';
        `);

        // Обновляем существующих посетителей без штрихкода
        const visitorsWithoutBarcode = await pool.query(`
            SELECT COUNT(*) as count FROM visitors WHERE barcode IS NULL
        `);

        const visitorsCount = parseInt(visitorsWithoutBarcode.rows[0].count);

        if (visitorsCount > 0) {
            console.log(`📋 Найдено ${visitorsCount} посетителей без штрихкода`);
            console.log('📋 Генерация штрихкодов для существующих посетителей...');

            // Получаем всех посетителей без штрихкода
            const visitorsResult = await pool.query(`
                SELECT id, created_at 
                FROM visitors 
                WHERE barcode IS NULL 
                ORDER BY created_at ASC
            `);

            let index = 1;
            for (const visitor of visitorsResult.rows) {
                const barcode = generateBarcode(index, new Date(visitor.created_at));

                try {
                    await pool.query(
                        'UPDATE visitors SET barcode = $1 WHERE id = $2',
                        [barcode, visitor.id]
                    );

                    if (index <= 5) { // Показываем только первые 5 для примера
                        console.log(`   ✅ Посетитель ID ${visitor.id}: ${barcode}`);
                    }
                } catch (err) {
                    if (err.code === '23505') { // unique violation
                        // Если штрихкод уже существует, генерируем новый с добавлением случайного числа
                        const uniqueBarcode = barcode + Math.floor(Math.random() * 100);
                        await pool.query(
                            'UPDATE visitors SET barcode = $1 WHERE id = $2',
                            [uniqueBarcode, visitor.id]
                        );
                        console.log(`   ⚠️  Посетитель ID ${visitor.id}: ${uniqueBarcode} (исправлен дубликат)`);
                    } else {
                        throw err;
                    }
                }

                index++;
            }

            if (visitorsCount > 5) {
                console.log(`   ... и еще ${visitorsCount - 5} посетителей`);
            }

            console.log('✅ Штрихкоды сгенерированы для всех посетителей');
        }

        // Проверяем результаты
        console.log('\n📊 Результаты миграции:');

        const finalStats = await pool.query(`
            SELECT 
                COUNT(*) as total_visitors,
                COUNT(barcode) as visitors_with_barcode,
                COUNT(CASE WHEN barcode IS NULL THEN 1 END) as visitors_without_barcode
            FROM visitors
        `);

        const stats = finalStats.rows[0];
        console.log(`   👥 Всего посетителей: ${stats.total_visitors}`);
        console.log(`   📊 С штрихкодами: ${stats.visitors_with_barcode}`);
        console.log(`   ❌ Без штрихкодов: ${stats.visitors_without_barcode}`);

        // Показываем примеры штрихкодов
        const sampleBarcodes = await pool.query(`
            SELECT barcode, last_name, first_name 
            FROM visitors 
            WHERE barcode IS NOT NULL 
            ORDER BY created_at 
            LIMIT 3
        `);

        if (sampleBarcodes.rows.length > 0) {
            console.log('\n📋 Примеры сгенерированных штрихкодов:');
            sampleBarcodes.rows.forEach(visitor => {
                console.log(`   📊 ${visitor.barcode} - ${visitor.last_name} ${visitor.first_name}`);
            });
        }

        console.log('\n🎉 Миграция успешно завершена!');
        console.log('\n💡 Что изменилось:');
        console.log('   ✨ Добавлено поле barcode в таблицу visitors');
        console.log('   ✨ Создан индекс для быстрого поиска по штрихкоду');
        console.log('   ✨ Сгенерированы уникальные штрихкоды для всех существующих посетителей');
        console.log('   ✨ QR коды теперь генерируются из штрихкодов, а не из UUID');

        console.log('\n🚀 Следующие шаги:');
        console.log('   1. Обновите routes/visitors.js');
        console.log('   2. Обновите routes/scan.js');
        console.log('   3. Обновите public/index.html');
        console.log('   4. Обновите public/scan.html');
        console.log('   5. Перезапустите сервер');

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
async function rollbackBarcodeMigration() {
    console.log('🔄 Откат миграции штрихкодов...\n');

    const pool = new Pool(dbConfig);

    try {
        await pool.query('SELECT 1');
        console.log('✅ Подключение к базе данных установлено');

        // Удаляем колонку barcode
        console.log('📋 Удаление колонки barcode...');
        await pool.query('ALTER TABLE visitors DROP COLUMN IF EXISTS barcode CASCADE');
        console.log('✅ Колонка barcode удалена');

        console.log('\n✅ Откат миграции завершен');
        console.log('💡 Не забудьте откатить изменения в коде!');

    } catch (err) {
        console.error('❌ Ошибка отката:', err);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

// Проверка статуса миграции
async function checkBarcodeStatus() {
    const pool = new Pool(dbConfig);

    try {
        await pool.query('SELECT 1');
        console.log('📊 Статус миграции штрихкодов:\n');

        // Проверяем колонку barcode
        const barcodeColumn = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.columns 
                WHERE table_name = 'visitors' 
                AND column_name = 'barcode'
            );
        `);
        console.log(`📊 Колонка barcode: ${barcodeColumn.rows[0].exists ? '✅ существует' : '❌ отсутствует'}`);

        // Проверяем индекс
        const barcodeIndex = await pool.query(`
            SELECT EXISTS (
                SELECT FROM pg_indexes 
                WHERE tablename = 'visitors' 
                AND indexname = 'idx_visitors_barcode'
            );
        `);
        console.log(`🔍 Индекс штрихкода: ${barcodeIndex.rows[0].exists ? '✅ существует' : '❌ отсутствует'}`);

        if (barcodeColumn.rows[0].exists) {
            // Считаем данные
            const counts = await pool.query(`
                SELECT 
                    COUNT(*) as total_visitors,
                    COUNT(barcode) as visitors_with_barcode,
                    COUNT(CASE WHEN barcode IS NULL THEN 1 END) as visitors_without_barcode
                FROM visitors
            `);
            console.log(`👥 Всего посетителей: ${counts.rows[0].total_visitors}`);
            console.log(`📊 С штрихкодами: ${counts.rows[0].visitors_with_barcode}`);
            console.log(`❌ Без штрихкодов: ${counts.rows[0].visitors_without_barcode}`);
        }

        const migrationComplete = barcodeColumn.rows[0].exists && barcodeIndex.rows[0].exists;
        console.log(`\n🏁 Статус миграции: ${migrationComplete ? '✅ ЗАВЕРШЕНА' : '❌ НЕ ЗАВЕРШЕНА'}`);

    } catch (err) {
        console.error('❌ Ошибка проверки статуса:', err);
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
            await addBarcodeField();
            break;
        case 'rollback':
        case 'down':
            const confirmed = process.argv[3] === '--confirm';
            if (!confirmed) {
                console.log('⚠️  Откат миграции удалит все штрихкоды!');
                console.log('Используйте: node add-barcode-migration.js rollback --confirm');
                return;
            }
            await rollbackBarcodeMigration();
            break;
        case 'status':
            await checkBarcodeStatus();
            break;
        default:
            console.log('🔧 Скрипт миграции для добавления штрихкодов');
            console.log('=============================================');
            console.log('Использование:');
            console.log('  node add-barcode-migration.js migrate     # Применить миграцию');
            console.log('  node add-barcode-migration.js rollback --confirm # Откатить миграцию');
            console.log('  node add-barcode-migration.js status      # Проверить статус');
            console.log('');
            console.log('Миграция добавляет:');
            console.log('  - Поле barcode в таблицу visitors');
            console.log('  - Индекс для быстрого поиска по штрихкоду');
            console.log('  - Автоматическую генерацию штрихкодов для существующих посетителей');
            console.log('  - QR коды теперь генерируются из штрихкодов');
    }
}

// Запускаем только если файл выполняется напрямую
if (require.main === module) {
    main().catch(console.error);
}

module.exports = { addBarcodeField, rollbackBarcodeMigration, checkBarcodeStatus };