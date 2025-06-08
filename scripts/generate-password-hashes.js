// scripts/generate-password-hashes.js
// Скрипт для генерации правильных хешей паролей для пользователей

const bcrypt = require('bcryptjs');

async function generateHashes() {
    const saltRounds = 12;

    const passwords = {
        admin: 'admin123',
        moderator: 'moderator123',
        skd: 'skd123'
    };

    console.log('🔐 Генерация хешей паролей...\n');

    for (const [user, password] of Object.entries(passwords)) {
        try {
            const hash = await bcrypt.hash(password, saltRounds);
            console.log(`${user}:`);
            console.log(`  Пароль: ${password}`);
            console.log(`  Хеш: ${hash}`);
            console.log('');
        } catch (error) {
            console.error(`Ошибка генерации хеша для ${user}:`, error);
        }
    }

    // Проверяем хеши
    console.log('\n✅ Проверка хешей:');

    // Генерируем новые правильные хеши
    console.log('\n=== ПРАВИЛЬНЫЕ ХЕШИ ДЛЯ init.sql ===\n');

    const correctAdminHash = await bcrypt.hash('admin123', 12);
    const correctModeratorHash = await bcrypt.hash('moderator123', 12);
    const correctSkdHash = await bcrypt.hash('skd123', 12);

    console.log(`-- admin123`);
    console.log(`'${correctAdminHash}'`);
    console.log();

    console.log(`-- moderator123`);
    console.log(`'${correctModeratorHash}'`);
    console.log();

    console.log(`-- skd123`);
    console.log(`'${correctSkdHash}'`);
    console.log();

    // Проверяем новые хеши
    console.log('🔍 Проверка новых хешей:');
    console.log(`admin123: ${await bcrypt.compare('admin123', correctAdminHash) ? '✅' : '❌'}`);
    console.log(`moderator123: ${await bcrypt.compare('moderator123', correctModeratorHash) ? '✅' : '❌'}`);
    console.log(`skd123: ${await bcrypt.compare('skd123', correctSkdHash) ? '✅' : '❌'}`);

    console.log('\n💡 Скопируйте хеши выше и замените их в файле init.sql');
}

// Функция для генерации хеша конкретного пароля
async function generateSingleHash(password, rounds = 12) {
    if (!password) {
        console.log('❌ Требуется указать пароль');
        console.log('Использование: node generate-password-hashes.js <password> [rounds]');
        return;
    }

    try {
        const hash = await bcrypt.hash(password, rounds);

        console.log('🔐 Генерация хеша пароля');
        console.log('=' .repeat(30));
        console.log(`Пароль: ${password}`);
        console.log(`Раунды: ${rounds}`);
        console.log(`Хеш: ${hash}`);
        console.log();

        // Проверяем хеш
        const isValid = await bcrypt.compare(password, hash);
        console.log(`Проверка: ${isValid ? '✅ Корректно' : '❌ Ошибка'}`);

        if (isValid) {
            console.log('\n📋 Для использования в init.sql:');
            console.log(`'${hash}'`);
        }

    } catch (error) {
        console.error('❌ Ошибка генерации хеша:', error.message);
    }
}

// Главная функция
async function main() {
    const args = process.argv.slice(2);

    if (args.length > 0) {
        // Генерируем хеш для конкретного пароля
        const password = args[0];
        const rounds = parseInt(args[1]) || 12;
        await generateSingleHash(password, rounds);
    } else {
        // Генерируем хеши для всех демо паролей
        await generateHashes();
    }
}

// Запускаем только если файл выполняется напрямую
if (require.main === module) {
    main().catch(console.error);
}

module.exports = { generateHashes, generateSingleHash };