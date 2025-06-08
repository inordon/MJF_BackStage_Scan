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

// Rate limiting с улучшенными настройками
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 минут
    max: 1000, // 1000 запросов за окно
    message: { error: 'Слишком много запросов с этого IP' },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
        return req.url.startsWith('/uploads/') ||
            req.url.startsWith('/favicon.ico');
    }
});
app.use(generalLimiter);

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 минут
    max: 20, // 20 попыток входа за 15 минут
    message: { error: 'Слишком много попыток входа. Попробуйте через 15 минут.' },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    skipFailedRequests: false
});

const apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 минута
    max: 60, // 60 запросов в минуту
    message: { error: 'Слишком много API запросов' },
    standardHeaders: true,
    legacyHeaders: false
});

// Middleware
app.use(compression());

// Детальное логирование
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

// Настройка сессий
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key-change-this',
    resave: false,
    saveUninitialized: false,
    name: 'visitor.sid',
    cookie: {
        secure: process.env.NODE_ENV === 'production' && process.env.HTTPS === 'true',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000, // 24 часа
        sameSite: 'lax'
    },
    rolling: true
}));

// Статические файлы
app.use('/uploads', express.static(uploadDir));
app.use(express.static('public'));

// Импорт маршрутов
const authRoutes = require('./routes/auth');
const visitorRoutes = require('./routes/visitors');
const scanRoutes = require('./routes/scan');
const adminRoutes = require('./routes/admin');
const eventRoutes = require('./routes/events'); // Новые маршруты для событий

// Маршруты API
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/visitors', apiLimiter, visitorRoutes);
app.use('/api/scan', apiLimiter, scanRoutes);
app.use('/api/admin', apiLimiter, adminRoutes);
app.use('/api/events', apiLimiter, eventRoutes); // Подключаем маршруты событий

// Главная страница
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Страница сканирования
app.get('/scan/:uuid', async (req, res) => {
    const { uuid } = req.params;

    // Проверяем авторизацию
    if (!req.session.userId) {
        return res.redirect(`/login?return=/scan/${uuid}`);
    }

    res.sendFile(path.join(__dirname, 'public', 'scan.html'));
});

// Страница авторизации
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: process.env.APP_VERSION || '1.0.0'
    });
});

// Middleware для обработки ошибок multer
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ error: 'Файл слишком большой. Максимальный размер: 5MB' });
        }
        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
            return res.status(400).json({ error: 'Неожиданный файл в запросе' });
        }
    }

    if (err.message && err.message.includes('Only images allowed')) {
        return res.status(400).json({ error: 'Разрешены только изображения' });
    }

    console.error('Ошибка Multer:', err);
    next(err);
});

// Обработка ошибок 404
app.use((req, res) => {
    res.status(404).json({ error: 'Страница не найдена' });
});

// Обработка глобальных ошибок
app.use((err, req, res, next) => {
    console.error('Глобальная ошибка сервера:', err);

    // Специальная обработка ошибок rate limiting
    if (err.status === 429) {
        return res.status(429).json({
            error: 'Слишком много запросов',
            retryAfter: err.retryAfter
        });
    }

    if (err.type === 'entity.too.large') {
        return res.status(413).json({ error: 'Запрос слишком большой' });
    }

    // Обработка ошибок валидации
    if (err.name === 'ValidationError') {
        return res.status(400).json({
            error: 'Ошибка валидации данных',
            details: err.message
        });
    }

    // Обработка ошибок базы данных
    if (err.code === '23505') { // Unique constraint violation
        return res.status(400).json({
            error: 'Запись с такими данными уже существует'
        });
    }

    if (err.code === '23503') { // Foreign key constraint violation
        return res.status(400).json({
            error: 'Ссылка на несуществующую запись'
        });
    }

    // В production не показываем детали ошибок
    const isDevelopment = process.env.NODE_ENV === 'development';

    res.status(err.status || 500).json({
        error: err.message || 'Внутренняя ошибка сервера',
        ...(isDevelopment && {
            details: err.message,
            stack: err.stack
        })
    });
});

// Graceful shutdown
const gracefulShutdown = (signal) => {
    console.log(`🛑 Получен сигнал ${signal}, начинаем graceful shutdown...`);

    const { closePool } = require('./config/database');

    closePool().then(() => {
        console.log('✅ Соединения с БД закрыты');
        process.exit(0);
    }).catch((err) => {
        console.error('❌ Ошибка при закрытии соединений с БД:', err);
        process.exit(1);
    });
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Обработка необработанных промисов
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    // В production можно добавить логирование в файл или внешний сервис
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    // В production лучше перезапустить процесс
    if (process.env.NODE_ENV === 'production') {
        process.exit(1);
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    console.log(`📊 Режим: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔒 База данных: ${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432}`);
    console.log(`🌐 Доступен по адресу: http://localhost:${PORT}`);

    // Показываем демо аккаунты только в development
    if (process.env.NODE_ENV !== 'production') {
        console.log('🔐 Демо аккаунты:');
        console.log('   👑 admin / admin123');
        console.log('   ⚙️ moderator / moderator123');
        console.log('   🔒 skd_user / skd123');
    }

    console.log('✨ Новые возможности:');
    console.log('   🎯 Управление событиями');
    console.log('   📊 Статистика по событиям');
    console.log('   🔗 Привязка посетителей к событиям');
});

module.exports = app;