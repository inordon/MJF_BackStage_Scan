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
                "https://unpkg.com" // Добавляем запасной CDN
            ],
            scriptSrcAttr: ["'unsafe-inline'"], // Разрешаем onclick
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
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 минут
    max: 100, // максимум 100 запросов за окно
    message: 'Слишком много запросов с этого IP'
});
app.use(limiter);

// Более строгий лимит для авторизации
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5, // максимум 5 попыток входа за 15 минут
    message: 'Слишком много попыток входа'
});

// Middleware
app.use(compression());
app.use(morgan('combined'));
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
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 часа
    }
}));

// Статические файлы
app.use('/uploads', express.static(uploadDir));
app.use(express.static('public'));

// Импорт маршрутов
const authRoutes = require('./routes/auth');
const visitorRoutes = require('./routes/visitors');
const scanRoutes = require('./routes/scan');
const adminRoutes = require('./routes/admin');

// Маршруты API
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/visitors', visitorRoutes);
app.use('/api/scan', scanRoutes);
app.use('/api/admin', adminRoutes);

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

// Обработка ошибок 404
app.use((req, res) => {
    res.status(404).json({ error: 'Страница не найдена' });
});

// Обработка глобальных ошибок
app.use((err, req, res, next) => {
    console.error('Ошибка сервера:', err);

    if (err.type === 'entity.too.large') {
        return res.status(413).json({ error: 'Файл слишком большой' });
    }

    res.status(500).json({
        error: 'Внутренняя ошибка сервера',
        ...(process.env.NODE_ENV === 'development' && { details: err.message })
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    console.log(`📊 Режим: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔒 База данных: ${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432}`);
});

module.exports = app;