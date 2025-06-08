// generate-password-hashes.js
// Скрипт для генерации правильных хешей паролей для пользователей

const bcrypt = require('bcryptjs');

async function generateHashes() {
    const saltRounds = 12;

    const passwords = {
        admin: 'admin123',
        moderator: 'moderator123',
        skd: 'skd123'
    };

    console.log('Генерация хешей паролей...\n');

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
    console.log('\nПроверка хешей:');

    // Проверяем admin123
    const adminHash = '$2b$12$vMJZKJuZYYz7X3JU7L4a1OPxrJN5fQLT2D4BVGZ8QGjZU7U8gE6kq';
    const adminCheck = await bcrypt.compare('admin123', adminHash);
    console.log(`admin123 -> ${adminHash}: ${adminCheck ? '✅ OK' : '❌ FAIL'}`);

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
    console.log('Проверка новых хешей:');
    console.log(`admin123: ${await bcrypt.compare('admin123', correctAdminHash) ? '✅' : '❌'}`);
    console.log(`moderator123: ${await bcrypt.compare('moderator123', correctModeratorHash) ? '✅' : '❌'}`);
    console.log(`skd123: ${await bcrypt.compare('skd123', correctSkdHash) ? '✅' : '❌'}`);
}

// Запускаем только если файл выполняется напрямую
if (require.main === module) {
    generateHashes().catch(console.error);
}

module.exports = { generateHashes };