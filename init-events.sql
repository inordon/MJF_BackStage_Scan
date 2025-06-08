-- Обновленная схема базы данных с поддержкой событий
-- Файл: init-events.sql

-- Добавляем таблицу событий
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

-- Добавляем колонку event_id в таблицу visitors
ALTER TABLE visitors ADD COLUMN event_id INTEGER REFERENCES events(id);

-- Добавляем индексы для производительности
CREATE INDEX idx_events_dates ON events(start_date, end_date);
CREATE INDEX idx_events_status ON events(status);
CREATE INDEX idx_events_created_at ON events(created_at);
CREATE INDEX idx_visitors_event_id ON visitors(event_id);

-- Создание триггера для автоматического обновления updated_at для events
CREATE TRIGGER update_events_updated_at
    BEFORE UPDATE ON events
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Создание представления для статистики событий
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

-- Функция для получения статистики события
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

-- Создаем несколько тестовых событий
INSERT INTO events (name, description, start_date, end_date, location, created_by) VALUES
                                                                                       ('Конференция IT-2024', 'Ежегодная IT конференция', '2024-06-15', '2024-06-17', 'Москва, ЦВК "Экспоцентр"', 1),
                                                                                       ('Выставка инноваций', 'Выставка новых технологий', '2024-07-01', '2024-07-03', 'СПб, Ленэкспо', 1),
                                                                                       ('Семинар по безопасности', 'Обучающий семинар', '2024-06-20', '2024-06-20', 'Онлайн', 1);

-- Обновляем существующих посетителей, привязывая их к первому событию
UPDATE visitors SET event_id = 1 WHERE event_id IS NULL;

-- Права доступа
GRANT ALL PRIVILEGES ON TABLE events TO visitor_admin;
GRANT ALL PRIVILEGES ON SEQUENCE events_id_seq TO visitor_admin;
GRANT SELECT ON events_stats TO visitor_admin;
GRANT EXECUTE ON FUNCTION get_event_stats TO visitor_admin;