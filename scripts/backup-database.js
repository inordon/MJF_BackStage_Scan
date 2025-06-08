// scripts/backup-database.js
// Скрипт для создания бэкапа базы данных

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// Конфигурация подключения к базе данных
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'visitor_system',
    user: process.env.DB_USER || 'visitor_admin',
    password: process.env.DB_PASSWORD || 'secure_password_123'
};

// Создание директории для бэкапов
function ensureBackupDirectory() {
    const backupDir = path.join(__dirname, '..', 'backups');
    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
        console.log(`📁 Создана директория для бэкапов: ${backupDir}`);
    }
    return backupDir;
}

// Генерация имени файла бэкапа
function generateBackupFilename(type = 'full') {
    const now = new Date();
    const timestamp = now.toISOString()
        .replace(/[:.]/g, '-')
        .replace('T', '_')
        .split('.')[0]; // убираем миллисекунды

    return `visitor_system_${type}_${timestamp}.sql`;
}

// Создание SQL дампа с помощью pg_dump
async function createSQLDump(outputPath, options = {}) {
    return new Promise((resolve, reject) => {
        const args = [
            '-h', dbConfig.host,
            '-p', dbConfig.port.toString(),
            '-U', dbConfig.user,
            '-d', dbConfig.database,
            '-f', outputPath,
            '--verbose'
        ];

        // Дополнительные опции
        if (options.dataOnly) {
            args.push('--data-only');
        }

        if (options.schemaOnly) {
            args.push('--schema-only');
        }

        if (options.clean) {
            args.push('--clean');
        }

        if (options.ifExists) {
            args.push('--if-exists');
        }

        // Добавляем CREATE DATABASE и подключение
        if (!options.dataOnly) {
            args.push('--create');
        }

        console.log(`🔄 Запуск pg_dump с параметрами: ${args.join(' ')}`);

        const pgDump = spawn('pg_dump', args, {
            env: {
                ...process.env,
                PGPASSWORD: dbConfig.password
            }
        });

        let errorOutput = '';

        pgDump.stderr.on('data', (data) => {
            const output = data.toString();
            // pg_dump выводит прогресс в stderr, это нормально
            if (output.includes('ERROR') || output.includes('FATAL')) {
                errorOutput += output;
            }
            process.stdout.write(output);
        });

        pgDump.on('close', (code) => {
            if (code === 0) {
                resolve(outputPath);
            } else {
                reject(new Error(`pg_dump завершился с кодом ${code}. Ошибки: ${errorOutput}`));
            }
        });

        pgDump.on('error', (err) => {
            if (err.code === 'ENOENT') {
                reject(new Error('pg_dump не найден. Убедитесь, что PostgreSQL клиент установлен и доступен в PATH'));
            } else {
                reject(err);
            }
        });
    });
}

// Создание бэкапа через JavaScript (альтернативный метод)
async function createJSBackup(outputPath) {
    const pool = new Pool(dbConfig);

    try {
        console.log('📊 Получение структуры базы данных...');

        // Получаем список таблиц
        const tablesResult = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            ORDER BY table_name
        `);

        const tables = tablesResult.rows.map(row => row.table_name);
        console.log(`📋 Найдено таблиц: ${tables.length}`);

        let backupContent = [];

        // Заголовок бэкапа
        backupContent.push(`-- Бэкап базы данных visitor_system`);
        backupContent.push(`-- Создан: ${new Date().toLocaleString('ru-RU')}`);
        backupContent.push(`-- Версия PostgreSQL: ${(await pool.query('SELECT version()')).rows[0].version}`);
        backupContent.push('-- ');
        backupContent.push('');

        // Отключаем уведомления и проверки
        backupContent.push('SET statement_timeout = 0;');
        backupContent.push('SET lock_timeout = 0;');
        backupContent.push('SET client_encoding = \'UTF8\';');
        backupContent.push('SET standard_conforming_strings = on;');
        backupContent.push('');

        // Для каждой таблицы создаем структуру и данные
        for (const tableName of tables) {
            console.log(`📝 Обработка таблицы: ${tableName}`);

            // Получаем CREATE TABLE statement
            const createTableResult = await pool.query(`
                SELECT 
                    'CREATE TABLE ' || table_name || ' (' ||
                    string_agg(
                        column_name || ' ' || 
                        CASE 
                            WHEN data_type = 'character varying' THEN 'VARCHAR(' || character_maximum_length || ')'
                            WHEN data_type = 'character' THEN 'CHAR(' || character_maximum_length || ')'
                            WHEN data_type = 'numeric' THEN 'NUMERIC(' || numeric_precision || ',' || numeric_scale || ')'
                            ELSE UPPER(data_type)
                        END ||
                        CASE WHEN is_nullable = 'NO' THEN ' NOT NULL' ELSE '' END,
                        ', '
                    ) || ');' as create_statement
                FROM information_schema.columns 
                WHERE table_name = $1 
                GROUP BY table_name
            `, [tableName]);

            if (createTableResult.rows.length > 0) {
                backupContent.push(`-- Структура таблицы ${tableName}`);
                backupContent.push(`DROP TABLE IF EXISTS ${tableName} CASCADE;`);
                backupContent.push(createTableResult.rows[0].create_statement);
                backupContent.push('');
            }

            // Получаем данные таблицы
            const dataResult = await pool.query(`SELECT * FROM ${tableName}`);

            if (dataResult.rows.length > 0) {
                backupContent.push(`-- Данные таблицы ${tableName}`);

                // Получаем имена колонок
                const columns = Object.keys(dataResult.rows[0]);

                for (const row of dataResult.rows) {
                    const values = columns.map(col => {
                        const value = row[col];
                        if (value === null) return 'NULL';
                        if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`;
                        if (value instanceof Date) return `'${value.toISOString()}'`;
                        if (typeof value === 'boolean') return value ? 'true' : 'false';
                        return value;
                    });

                    backupContent.push(
                        `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${values.join(', ')});`
                    );
                }

                backupContent.push('');
            }
        }

        // Восстанавливаем последовательности
        backupContent.push('-- Восстановление последовательностей');
        for (const tableName of tables) {
            const sequenceResult = await pool.query(`
                SELECT column_name, column_default
                FROM information_schema.columns 
                WHERE table_name = $1 
                  AND column_default LIKE 'nextval%'
            `, [tableName]);

            for (const seqRow of sequenceResult.rows) {
                const maxResult = await pool.query(`SELECT MAX(${seqRow.column_name}) as max_val FROM ${tableName}`);
                const maxVal = maxResult.rows[0].max_val || 0;

                if (maxVal > 0) {
                    const sequenceName = seqRow.column_default.match(/'([^']+)'/)?.[1];
                    if (sequenceName) {
                        backupContent.push(`SELECT setval('${sequenceName}', ${maxVal + 1});`);
                    }
                }
            }
        }

        // Записываем бэкап в файл
        fs.writeFileSync(outputPath, backupContent.join('\n'), 'utf8');

        console.log(`✅ JavaScript бэкап создан: ${outputPath}`);

    } finally {
        await pool.end();
    }
}

// Получение статистики базы данных
async function getDatabaseStats() {
    const pool = new Pool(dbConfig);

    try {
        console.log('\n📊 Статистика базы данных:');

        // Общая информация
        const dbInfoResult = await pool.query(`
            SELECT 
                current_database() as database_name,
                current_user as current_user,
                version() as version
        `);

        const dbInfo = dbInfoResult.rows[0];
        console.log(`   База данных: ${dbInfo.database_name}`);
        console.log(`   Пользователь: ${dbInfo.current_user}`);
        console.log(`   Версия: ${dbInfo.version.split(' ')[0]} ${dbInfo.version.split(' ')[1]}`);

        // Размер базы данных
        const sizeResult = await pool.query(`
            SELECT pg_size_pretty(pg_database_size(current_database())) as database_size
        `);
        console.log(`   Размер: ${sizeResult.rows[0].database_size}`);

        // Статистика таблиц
        const tablesStatsResult = await pool.query(`
            SELECT 
                schemaname,
                tablename,
                (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = tablename) as columns_count,
                n_tup_ins as inserts,
                n_tup_upd as updates,
                n_tup_del as deletes
            FROM pg_stat_user_tables 
            ORDER BY tablename
        `);

        console.log('\n📋 Статистика таблиц:');
        for (const table of tablesStatsResult.rows) {
            console.log(`   ${table.tablename}: ${table.columns_count} колонок, ` +
                `${table.inserts} вставок, ${table.updates} обновлений, ${table.deletes} удалений`);
        }

        // Количество записей
        const recordsResult = await pool.query(`
            SELECT 
                'users' as table_name, COUNT(*) as count FROM users
            UNION ALL
            SELECT 'visitors', COUNT(*) FROM visitors
            UNION ALL
            SELECT 'scans', COUNT(*) FROM scans
            UNION ALL
            SELECT 'user_sessions', COUNT(*) FROM user_sessions
        `);

        console.log('\n📊 Количество записей:');
        for (const record of recordsResult.rows) {
            console.log(`   ${record.table_name}: ${record.count} записей`);
        }

    } finally {
        await pool.end();
    }
}

// Создание полного бэкапа
async function createFullBackup() {
    console.log('💾 Создание полного бэкапа базы данных');
    console.log('=' .repeat(50));

    const backupDir = ensureBackupDirectory();
    const filename = generateBackupFilename('full');
    const outputPath = path.join(backupDir, filename);

    try {
        // Показываем статистику перед бэкапом
        await getDatabaseStats();

        console.log('\n🔄 Создание бэкапа...');

        // Пробуем использовать pg_dump, если не получается - используем JavaScript метод
        try {
            await createSQLDump(outputPath, {
                clean: true,
                ifExists: true
            });
            console.log(`✅ SQL дамп создан: ${filename}`);
        } catch (err) {
            console.log(`⚠️  pg_dump недоступен, используем JavaScript метод: ${err.message}`);
            await createJSBackup(outputPath);
        }

        // Проверяем размер созданного файла
        const stats = fs.statSync(outputPath);
        const fileSizeInMB = (stats.size / (1024 * 1024)).toFixed(2);

        console.log(`\n🎉 Бэкап успешно создан!`);
        console.log(`   Файл: ${outputPath}`);
        console.log(`   Размер: ${fileSizeInMB} MB`);
        console.log(`   Создан: ${new Date().toLocaleString('ru-RU')}`);

        return outputPath;

    } catch (err) {
        console.error('❌ Ошибка создания бэкапа:', err.message);
        throw err;
    }
}

// Создание бэкапа только данных
async function createDataBackup() {
    console.log('📊 Создание бэкапа данных (без структуры)');

    const backupDir = ensureBackupDirectory();
    const filename = generateBackupFilename('data');
    const outputPath = path.join(backupDir, filename);

    try {
        await createSQLDump(outputPath, {
            dataOnly: true
        });

        const stats = fs.statSync(outputPath);
        const fileSizeInMB = (stats.size / (1024 * 1024)).toFixed(2);

        console.log(`✅ Бэкап данных создан: ${filename} (${fileSizeInMB} MB)`);
        return outputPath;

    } catch (err) {
        console.log(`⚠️  Используем JavaScript метод: ${err.message}`);
        await createJSBackup(outputPath);
        return outputPath;
    }
}

// Создание бэкапа только структуры
async function createSchemaBackup() {
    console.log('🏗️  Создание бэкапа структуры (без данных)');

    const backupDir = ensureBackupDirectory();
    const filename = generateBackupFilename('schema');
    const outputPath = path.join(backupDir, filename);

    try {
        await createSQLDump(outputPath, {
            schemaOnly: true
        });

        const stats = fs.statSync(outputPath);
        const fileSizeInKB = (stats.size / 1024).toFixed(2);

        console.log(`✅ Бэкап структуры создан: ${filename} (${fileSizeInKB} KB)`);
        return outputPath;

    } catch (err) {
        console.error('❌ Ошибка создания бэкапа структуры:', err.message);
        throw err;
    }
}

// Главная функция
async function main() {
    const args = process.argv.slice(2);
    const backupType = args[0] || 'full';

    try {
        // Проверяем подключение к базе данных
        const pool = new Pool(dbConfig);
        await pool.query('SELECT 1');
        await pool.end();

        switch (backupType) {
            case 'full':
                await createFullBackup();
                break;
            case 'data':
                await createDataBackup();
                break;
            case 'schema':
                await createSchemaBackup();
                break;
            default:
                console.log('❌ Неизвестный тип бэкапа');
                console.log('Использование: node backup-database.js [full|data|schema]');
                console.log('   full   - полный бэкап (по умолчанию)');
                console.log('   data   - только данные');
                console.log('   schema - только структура');
                process.exit(1);
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

module.exports = {
    createFullBackup,
    createDataBackup,
    createSchemaBackup,
    getDatabaseStats
};