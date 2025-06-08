#!/bin/bash

# Цвета для вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Запуск системы управления посетителями${NC}"
echo "================================================"

# Проверяем наличие Docker и Docker Compose
command -v docker >/dev/null 2>&1 || { echo -e "${RED}❌ Docker не установлен${NC}" >&2; exit 1; }
command -v docker-compose >/dev/null 2>&1 || { echo -e "${RED}❌ Docker Compose не установлен${NC}" >&2; exit 1; }

# Проверяем запущен ли Docker
if ! docker info >/dev/null 2>&1; then
    echo -e "${RED}❌ Docker не запущен. Запустите Docker и попробуйте снова.${NC}"
    exit 1
fi

# Создаем .env файл если его нет
if [ ! -f .env ]; then
    echo -e "${YELLOW}📝 Создание .env файла...${NC}"
    cat > .env << 'EOF'
# База данных
DB_HOST=postgres
DB_PORT=5432
DB_NAME=visitor_system
DB_USER=visitor_admin
DB_PASSWORD=secure_password_123

# Приложение
NODE_ENV=production
PORT=3000
SESSION_SECRET=your-super-secret-session-key-change-this
JWT_SECRET=your-jwt-secret-change-this

# Пути
UPLOAD_PATH=/app/uploads
FRONTEND_URL=http://localhost:3000
APP_VERSION=1.0.0
EOF
    echo -e "${GREEN}✅ Файл .env создан${NC}"
fi

# Создаем необходимые директории
echo -e "${YELLOW}📁 Создание директорий...${NC}"
mkdir -p uploads/photos uploads/qr-codes backups

# Останавливаем существующие контейнеры
echo -e "${YELLOW}🛑 Остановка существующих контейнеров...${NC}"
docker-compose down

# Собираем и запускаем контейнеры
echo -e "${YELLOW}🔨 Сборка и запуск контейнеров...${NC}"
docker-compose up --build -d

# Ждем запуска базы данных
echo -e "${YELLOW}⏳ Ожидание запуска базы данных...${NC}"
for i in {1..30}; do
    if docker-compose exec -T postgres pg_isready -U visitor_admin -d visitor_system >/dev/null 2>&1; then
        echo -e "${GREEN}✅ База данных готова${NC}"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "${RED}❌ Таймаут ожидания базы данных${NC}"
        exit 1
    fi
    sleep 2
done

# Ждем запуска приложения
echo -e "${YELLOW}⏳ Ожидание запуска приложения...${NC}"
for i in {1..30}; do
    if curl -s http://localhost:3000/api/admin/health >/dev/null 2>&1; then
        echo -e "${GREEN}✅ Приложение готово${NC}"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "${RED}❌ Таймаут ожидания приложения${NC}"
        exit 1
    fi
    sleep 2
done

echo
echo -e "${GREEN}🎉 Система успешно запущена!${NC}"
echo "================================================"
echo -e "🌐 Приложение доступно по адресу: ${BLUE}http://localhost:3000${NC}"
echo
echo -e "${YELLOW}👥 Демо аккаунты:${NC}"
echo -e "   👑 Администратор: ${GREEN}admin${NC} / ${GREEN}admin123${NC}"
echo -e "   ⚙️  Модератор:    ${GREEN}moderator${NC} / ${GREEN}moderator123${NC}"
echo -e "   🔒 СКД:          ${GREEN}skd_user${NC} / ${GREEN}skd123${NC}"
echo
echo -e "${YELLOW}📋 Полезные команды:${NC}"
echo "   docker-compose logs -f     # Просмотр логов"
echo "   docker-compose down        # Остановка"
echo "   docker-compose ps          # Статус контейнеров"
echo
echo -e "${BLUE}🔧 Для разработки используйте: npm run dev${NC}"