-- scripts/add-barcode-field.sql
-- Добавление поля barcode в таблицу visitors

-- Добавляем колонку barcode
ALTER TABLE visitors ADD COLUMN barcode VARCHAR(100) UNIQUE;

-- Создаем индекс для быстрого поиска по штрихкоду
CREATE INDEX idx_visitors_barcode ON visitors(barcode);

-- Добавляем комментарий
COMMENT ON COLUMN visitors.barcode IS 'Штрихкод посетителя для генерации QR кода';

-- Обновляем существующих посетителей, генерируя уникальные штрихкоды
-- Формат: VIS + год + месяц + день + последовательный номер (например: VIS20240615001)
UPDATE visitors
SET barcode = 'VIS' || TO_CHAR(created_at, 'YYYYMMDD') || LPAD(ROW_NUMBER() OVER (ORDER BY created_at)::text, 3, '0')
WHERE barcode IS NULL;