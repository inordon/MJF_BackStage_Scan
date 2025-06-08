-- Создание базы данных и схемы для системы управления посетителями
-- Файл: init.sql

-- Включаем расширения
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Создание таблицы пользователей
CREATE TABLE users (
                       id SERIAL PRIMARY KEY,
                       username VARCHAR(50) UNIQUE NOT NULL,
                       password_hash VARCHAR(255) NOT NULL,
                       full_name VARCHAR(100) NOT NULL,
                       role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'moderator', 'skd')),
                       email VARCHAR(100) UNIQUE,
                       is_active BOOLEAN DEFAULT true,
                       last_login TIMESTAMP,
                       created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                       updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                       created_by INTEGER REFERENCES users(id),
                       updated_by INTEGER REFERENCES users(id)
);

-- Создание таблицы посетителей
CREATE TABLE visitors (
                          id SERIAL PRIMARY KEY,
                          visitor_uuid UUID DEFAULT uuid_generate_v4() UNIQUE NOT NULL,
                          last_name VARCHAR(50) NOT NULL,
                          first_name VARCHAR(50) NOT NULL,
                          middle_name VARCHAR(50),
                          comment TEXT,
                          photo_path VARCHAR(255),
                          qr_code_path VARCHAR(255),
                          status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
                          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                          created_by INTEGER REFERENCES users(id),
                          updated_by INTEGER REFERENCES users(id)
);

-- Создание таблицы сканирований
CREATE TABLE scans (
                       id SERIAL PRIMARY KEY,
                       visitor_id INTEGER NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
                       scan_type VARCHAR(20) NOT NULL CHECK (scan_type IN ('first', 'repeat', 'duplicate', 'blocked_attempt', 'batch')),
                       scan_date DATE DEFAULT CURRENT_DATE,
                       scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                       scanned_by INTEGER REFERENCES users(id),
                       ip_address INET,
                       user_agent TEXT
);

-- Создание таблицы сессий пользователей
CREATE TABLE user_sessions (
                               id SERIAL PRIMARY KEY,
                               user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                               session_token VARCHAR(255) NOT NULL,
                               created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                               expires_at TIMESTAMP NOT NULL,
                               ip_address INET,
                               user_agent TEXT
);

-- Создание индексов для производительности
CREATE INDEX idx_visitors_uuid ON visitors(visitor_uuid);
CREATE INDEX idx_visitors_status ON visitors(status);
CREATE INDEX idx_visitors_created_at ON visitors(created_at);
CREATE INDEX idx_visitors_name ON visitors(last_name, first_name);

CREATE INDEX idx_scans_visitor_id ON scans(visitor_id);
CREATE INDEX idx_scans_date ON scans(scan_date);
CREATE INDEX idx_scans_type ON scans(scan_type);
CREATE INDEX idx_scans_scanned_at ON scans(scanned_at);

CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_active ON users(is_active);

CREATE INDEX idx_sessions_user_id ON user_sessions(user_id);
CREATE INDEX idx_sessions_token ON user_sessions(session_token);
CREATE INDEX idx_sessions_expires ON user_sessions(expires_at);

-- Создание функции для автоматического обновления updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
RETURN NEW;
END;
$$ language 'plpgsql';

-- Создание триггеров для автоматического обновления timestamps
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_visitors_updated_at
    BEFORE UPDATE ON visitors
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Создание функции для очистки просроченных сессий
CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS INTEGER AS $$
DECLARE
deleted_count INTEGER;
BEGIN
DELETE FROM user_sessions WHERE expires_at < CURRENT_TIMESTAMP;
GET DIAGNOSTICS deleted_count = ROW_COUNT;
RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Создание представления для статистики посетителей
CREATE VIEW visitors_stats AS
SELECT
    COUNT(*) as total_visitors,
    COUNT(CASE WHEN status = 'active' THEN 1 END) as active_visitors,
    COUNT(CASE WHEN status = 'blocked' THEN 1 END) as blocked_visitors,
    COUNT(CASE WHEN created_at::date = CURRENT_DATE THEN 1 END) as today_created,
    COUNT(CASE WHEN created_at >= CURRENT_DATE - INTERVAL '7 days' THEN 1 END) as week_created,
    COUNT(CASE WHEN created_at >= CURRENT_DATE - INTERVAL '30 days' THEN 1 END) as month_created
FROM visitors;

-- Создание представления для статистики сканирований
CREATE VIEW scans_stats AS
SELECT
    COUNT(*) as total_scans,
    COUNT(CASE WHEN scan_date = CURRENT_DATE THEN 1 END) as today_scans,
    COUNT(CASE WHEN scan_date >= CURRENT_DATE - INTERVAL '7 days' THEN 1 END) as week_scans,
    COUNT(CASE WHEN scan_date >= CURRENT_DATE - INTERVAL '30 days' THEN 1 END) as month_scans,
    COUNT(DISTINCT visitor_id) as unique_visitors_scanned,
    COUNT(CASE WHEN scan_type = 'first' THEN 1 END) as first_scans,
    COUNT(CASE WHEN scan_type = 'repeat' THEN 1 END) as repeat_scans,
    COUNT(CASE WHEN scan_type = 'blocked_attempt' THEN 1 END) as blocked_attempts
FROM scans;

-- Вставка администратора по умолчанию
-- Пароль: admin123
INSERT INTO users (username, password_hash, full_name, role, email, is_active)
VALUES (
           'admin',
           '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/lewdBPj6B8w1L3LcK', -- admin123
           'Системный администратор',
           'admin',
           'admin@example.com',
           true
       );

-- Вставка тестового модератора
-- Пароль: moderator123
INSERT INTO users (username, password_hash, full_name, role, email, is_active, created_by)
VALUES (
           'moderator',
           '$2b$12$9.1k1mB5BF0T9yYcC0.1JeDcZlZw4lrEJy1kgWqLqZXx1/G.S1L9K', -- moderator123
           'Тестовый модератор',
           'moderator',
           'moderator@example.com',
           true,
           1
       );

-- Вставка тестового сотрудника СКД
-- Пароль: skd123
INSERT INTO users (username, password_hash, full_name, role, email, is_active, created_by)
VALUES (
           'skd_user',
           '$2b$12$YQl8fJ0h9mTlN6pA8vE1OOH5zF0H4GtW2xJ6Y8L9vE5J3k9B7yN2M', -- skd123
           'Сотрудник СКД',
           'skd',
           'skd@example.com',
           true,
           1
       );

-- Вставка нескольких тестовых посетителей
INSERT INTO visitors (last_name, first_name, middle_name, comment, status, created_by) VALUES
                                                                                           ('Иванов', 'Иван', 'Иванович', 'Тестовый посетитель №1', 'active', 1),
                                                                                           ('Петров', 'Петр', 'Петрович', 'Тестовый посетитель №2', 'active', 1),
                                                                                           ('Сидоров', 'Сидор', 'Сидорович', 'Заблокированный посетитель', 'blocked', 1),
                                                                                           ('Козлов', 'Козлом', 'Козлович', 'VIP посетитель', 'active', 1),
                                                                                           ('Васильев', 'Василий', 'Васильевич', 'Обычный посетитель', 'active', 1);

-- Вставка тестовых сканирований
INSERT INTO scans (visitor_id, scan_type, scanned_by, ip_address) VALUES
                                                                      (1, 'first', 2, '192.168.1.100'),
                                                                      (2, 'first', 2, '192.168.1.100'),
                                                                      (1, 'repeat', 3, '192.168.1.101'),
                                                                      (4, 'first', 3, '192.168.1.102'),
                                                                      (3, 'blocked_attempt', 2, '192.168.1.103');

-- Создание функции для генерации отчетов
CREATE OR REPLACE FUNCTION generate_daily_report(report_date DATE DEFAULT CURRENT_DATE)
RETURNS TABLE (
    date_reported DATE,
    total_scans BIGINT,
    unique_visitors BIGINT,
    first_scans BIGINT,
    repeat_scans BIGINT,
    blocked_attempts BIGINT,
    peak_hour INTEGER
) AS $$
BEGIN
RETURN QUERY
SELECT
    report_date,
    COUNT(*) as total_scans,
    COUNT(DISTINCT visitor_id) as unique_visitors,
    COUNT(CASE WHEN scan_type = 'first' THEN 1 END) as first_scans,
    COUNT(CASE WHEN scan_type = 'repeat' THEN 1 END) as repeat_scans,
    COUNT(CASE WHEN scan_type = 'blocked_attempt' THEN 1 END) as blocked_attempts,
    (
        SELECT EXTRACT(HOUR FROM scanned_at)::INTEGER
        FROM scans
        WHERE scan_date = report_date
        GROUP BY EXTRACT(HOUR FROM scanned_at)
        ORDER BY COUNT(*) DESC
        LIMIT 1
    ) as peak_hour
FROM scans
WHERE scan_date = report_date;
END;
$$ LANGUAGE plpgsql;

-- Создание функции для поиска посетителей
CREATE OR REPLACE FUNCTION search_visitors(search_term TEXT)
RETURNS TABLE (
    id INTEGER,
    visitor_uuid UUID,
    full_name TEXT,
    comment TEXT,
    status VARCHAR(20),
    last_scan TIMESTAMP
) AS $$
BEGIN
RETURN QUERY
SELECT
    v.id,
    v.visitor_uuid,
    (v.last_name || ' ' || v.first_name || COALESCE(' ' || v.middle_name, ''))::TEXT as full_name,
        v.comment,
    v.status,
    MAX(s.scanned_at) as last_scan
FROM visitors v
         LEFT JOIN scans s ON v.id = s.visitor_id
WHERE
    v.last_name ILIKE '%' || search_term || '%' OR
        v.first_name ILIKE '%' || search_term || '%' OR
        v.middle_name ILIKE '%' || search_term || '%' OR
        v.comment ILIKE '%' || search_term || '%'
GROUP BY v.id, v.visitor_uuid, v.last_name, v.first_name, v.middle_name, v.comment, v.status
ORDER BY v.last_name, v.first_name;
END;
$$ LANGUAGE plpgsql;

-- Установка прав доступа
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO visitor_admin;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO visitor_admin;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO visitor_admin;

-- Вывод информации о созданных объектах
SELECT 'База данных успешно инициализирована!' as status;
SELECT 'Создано пользователей: ' || COUNT(*) as users_created FROM users;
SELECT 'Создано посетителей: ' || COUNT(*) as visitors_created FROM visitors;
SELECT 'Создано сканирований: ' || COUNT(*) as scans_created FROM scans;

-- Вывод информации о тестовых учетных записях
SELECT
    'Тестовые пользователи:' as info,
    username,
    role,
    'Пароль: ' ||
    CASE
        WHEN username = 'admin' THEN 'admin123'
        WHEN username = 'moderator' THEN 'moderator123'
        WHEN username = 'skd_user' THEN 'skd123'
        END as password_info
FROM users
WHERE username IN ('admin', 'moderator', 'skd_user')
ORDER BY id;