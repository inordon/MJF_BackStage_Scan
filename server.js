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

// Настройка безопасности
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
                "https://unpkg.com"
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

// Rate limiting
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 минут
    max: 1000, // 1000 запросов за окно
    message: { error: 'Слишком много запросов с этого IP' },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
        return req.url.startsWith('/uploads/') ||
            req.url.startsWith('/css/') ||
            req.url.startsWith('/js/') ||
            req.url.startsWith('/favicon.ico');
    }
});
app.use(generalLimiter);

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { error: 'Слишком много попыток входа. Попробуйте через 15 минут.' },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    skipFailedRequests: false
});

const apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 60,
    message: { error: 'Слишком много API запросов' },
    standardHeaders: true,
    legacyHeaders: false
});

// Middleware
app.use(compression({
    level: 6,
    threshold: 1024,
    filter: (req, res) => {
        if (req.headers['x-no-compression'] ||
            req.url.includes('.jpg') ||
            req.url.includes('.png') ||
            req.url.includes('.gif')) {
            return false;
        }
        return compression.filter(req, res);
    }
}));

// Логирование
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
app.use(express.static('public', {
    maxAge: process.env.NODE_ENV === 'production' ? '1d' : '0',
    etag: true,
    lastModified: true,
    index: false
}));

// JS файлы
app.use('/js', express.static(path.join(__dirname, 'public/js'), {
    maxAge: process.env.NODE_ENV === 'production' ? '1d' : '0',
    setHeaders: (res, filePath) => {
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        if (process.env.NODE_ENV === 'production') {
            res.setHeader('Cache-Control', 'public, max-age=86400');
        }
    }
}));

// CSS файлы
app.use('/css', express.static(path.join(__dirname, 'public/css'), {
    maxAge: process.env.NODE_ENV === 'production' ? '1d' : '0',
    setHeaders: (res, filePath) => {
        res.setHeader('Content-Type', 'text/css; charset=utf-8');
        if (process.env.NODE_ENV === 'production') {
            res.setHeader('Cache-Control', 'public, max-age=86400');
        }
    }
}));

// Загрузки
app.use('/uploads', express.static(uploadDir, {
    maxAge: process.env.NODE_ENV === 'production' ? '7d' : '0'
}));

// Импорт маршрутов
const authRoutes = require('./routes/auth');
const visitorRoutes = require('./routes/visitors');
const scanRoutes = require('./routes/scan');
const adminRoutes = require('./routes/admin');
const eventRoutes = require('./routes/events');

// Маршруты API
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/visitors', apiLimiter, visitorRoutes);
app.use('/api/scan', apiLimiter, scanRoutes);
app.use('/api/admin', apiLimiter, adminRoutes);
app.use('/api/events', apiLimiter, eventRoutes);

// Middleware для проверки авторизации на страницах
function requireAuth(req, res, next) {
    if (!req.session.userId) {
        return res.redirect(`/login?return=${encodeURIComponent(req.path)}`);
    }
    next();
}

// Маршруты для HTML страниц
app.get('/', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/visitors.html', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'visitors.html'));
});

app.get('/events.html', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'events.html'));
});

app.get('/scanner.html', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'scanner.html'));
});

app.get('/stats.html', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'stats.html'));
});

// Страница сканирования по UUID
app.get('/scan/:uuid', async (req, res) => {
    const { uuid } = req.params;

    if (!req.session.userId) {
        return res.redirect(`/login?return=/scan/${uuid}`);
    }

    res.sendFile(path.join(__dirname, 'public', 'scan.html'));
});

// Страница авторизации
app.get('/login', (req, res) => {
    if (req.session.userId) {
        const returnUrl = req.query.return || '/';
        return res.redirect(returnUrl);
    }
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Health check endpoints
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: process.env.APP_VERSION || '1.0.0',
        environment: process.env.NODE_ENV || 'development'
    });
});

app.get('/api/health', (req, res) => {
    res.json({
        healthy: true,
        timestamp: new Date().toISOString(),
        services: {
            database: 'ok',
            sessions: 'ok',
            uploads: fs.existsSync(uploadDir) ? 'ok' : 'error'
        }
    });
});

// Middleware для обработки ошибок multer
app.use((err, req, res, next) => {
    if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'Файл слишком большой. Максимальный размер: 5MB' });
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({ error: 'Неожиданный файл в запросе' });
    }

    if (err.message && err.message.includes('Only images allowed')) {
        return res.status(400).json({ error: 'Разрешены только изображения' });
    }

    console.error('Ошибка Multer:', err);
    next(err);
});

// Обработка ошибок 404
app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'API endpoint не найден' });
    }

    if (req.session.userId) {
        res.status(404).sendFile(path.join(__dirname, 'public', 'index.html'));
    } else {
        res.redirect('/login');
    }
});

// Обработка глобальных ошибок
app.use((err, req, res, next) => {
    console.error('Глобальная ошибка сервера:', err);

    if (err.status === 429) {
        return res.status(429).json({
            error: 'Слишком много запросов',
            retryAfter: err.retryAfter
        });
    }

    if (err.type === 'entity.too.large') {
        return res.status(413).json({ error: 'Запрос слишком большой' });
    }

    if (err.name === 'ValidationError') {
        return res.status(400).json({
            error: 'Ошибка валидации данных',
            details: err.message
        });
    }

    if (err.code === '23505') {
        return res.status(400).json({
            error: 'Запись с такими данными уже существует'
        });
    }

    if (err.code === '23503') {
        return res.status(400).json({
            error: 'Ссылка на несуществующую запись'
        });
    }

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

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    if (process.env.NODE_ENV === 'production') {
        process.exit(1);
    }
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

    console.log('✨ Оптимизации активны:');
    console.log('   📦 Сжатие включено');
    console.log('   🚀 Кэширование статических файлов');
    console.log('   🛡️ Rate limiting активен');
    console.log('   📁 Разделенные JS/CSS файлы');
});

module.exports = app;