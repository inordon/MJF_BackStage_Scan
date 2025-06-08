const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Инициализация базы данных
const { initDB } = require('./config/database');
initDB().catch(console.error);

// Создание директорий для загрузок
const uploadDir = process.env.UPLOAD_PATH || './uploads';
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}
if (!fs.existsSync(path.join(uploadDir, 'photos'))) {
    fs.mkdirSync(path.join(uploadDir, 'photos'), { recursive: true });
}
if (!fs.existsSync(path.join(uploadDir, 'qr-codes'))) {
    fs.mkdirSync(path.join(uploadDir, 'qr-codes'), { recursive: true });
}

// Настройка безопасности с исправленной CSP политикой
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: [
                "'self'",
                "'unsafe-inline'",
                "'unsafe-eval'",
                "https://cdnjs.cloudflare.com",
                "https://unpkg.com",
                "https://cdn.jsdelivr.net"
            ],
            scriptSrcAttr: ["'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "blob:"],
            mediaSrc: ["'self'", "blob:"],
            connectSrc: ["'self'"],
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            frameSrc: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
        },
    },
    crossOriginEmbedderPolicy: false,
}));

// Более мягкий общий rate limiting
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 минут
    max: 1000, // 1000 запросов за окно (было 100)
    message: { error: 'Слишком много запросов с этого IP' },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
        // Пропускаем статические файлы
        return req.url.startsWith('/uploads/') ||
            req.url.startsWith('/favicon.ico');
    }
});
app.use(generalLimiter);

// Более разумный лимит для авторизации
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 минут
    max: 20, // 20 попыток входа за 15 минут (было 5)
    message: { error: 'Слишком много попыток входа. Попробуйте через 15 минут.' },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true, // Не считаем успешные запросы
    skipFailedRequests: false
});

// Лимит для API запросов (более мягкий)
const apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 минута
    max: 60, // 60 запросов в минуту
    message: { error: 'Слишком много API запросов' },
    standardHeaders: true,
    legacyHeaders: false
});

// Middleware
app.use(compression());

// Более детальное логирование в development
if (process.env.NODE_ENV === 'development') {
    app.use(morgan('dev'));
} else {
    app.use(morgan('combined'));
}

app.use(cors({
    origin: process.env.FRONTEND_URL || true,
    credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Настройка сессий с улучшенными параметрами
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key-change-this',
    resave: false,
    saveUninitialized: false,
    name: 'visitor.sid', // Кастомное имя сессии
    cookie: {
        secure: process.env.NODE_ENV === 'production' && process.env.HTTPS === 'true',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000, // 24 часа
        sameSite: 'lax' // Помогает с CSRF защитой
    },
    rolling: true // Обновляем срок действия при активности
}));

// Статические файлы
app.use('/uploads', express.static(uploadDir));
app.use(express.static('public'));

// Импорт маршрутов
const authRoutes = require('./routes/auth');
const visitorRoutes = require('./routes/visitors');
const scanRoutes = require('./routes/scan');
const adminRoutes = require('./routes/admin');

// Маршруты API с правильными лимитами
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/visitors', apiLimiter, visitorRoutes);
app.use('/api/scan', apiLimiter, scanRoutes);
app.use('/api/admin', apiLimiter, adminRoutes);

// Главная страница
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Страница сканирования (для QR кодов)
app.get('/scan/:uuid', async (req, res) => {
    const { uuid } = req.params;

    // Проверяем авторизацию
    if (!req.session.userId) {
        // Перенаправляем на страницу авторизации с возвратом на сканирование
        return res.redirect(`/login?return=/scan/${uuid}`);
    }

    res.sendFile(path.join(__dirname, 'public', 'scan.html'));
});

// Страница авторизации
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Health check endpoint (без rate limiting)
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Обработка ошибок 404
app.use((req, res) => {
    res.status(404).json({ error: 'Страница не найдена' });
});

// Обработка глобальных ошибок
app.use((err, req, res, next) => {
    console.error('Ошибка сервера:', err);

    // Специальная обработка ошибок rate limiting
    if (err.status === 429) {
        return res.status(429).json({
            error: 'Слишком много запросов',
            retryAfter: err.retryAfter
        });
    }

    if (err.type === 'entity.too.large') {
        return res.status(413).json({ error: 'Файл слишком большой' });
    }

    // В production не показываем детали ошибок
    const isDevelopment = process.env.NODE_ENV === 'development';

    res.status(500).json({
        error: 'Внутренняя ошибка сервера',
        ...(isDevelopment && {
            details: err.message,
            stack: err.stack
        })
    });
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🛑 Получен сигнал SIGTERM, завершение работы...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('🛑 Получен сигнал SIGINT, завершение работы...');
    process.exit(0);
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    console.log(`📊 Режим: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔒 База данных: ${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432}`);
    console.log(`🌐 Доступен по адресу: http://localhost:${PORT}`);

    if (process.env.NODE_ENV !== 'production') {
        console.log('🔐 Демо аккаунты:');
        console.log('   👑 admin / admin123');
        console.log('   ⚙️ moderator / moderator123');
        console.log('   🔒 skd_user / skd123');
    }
});

module.exports = app;