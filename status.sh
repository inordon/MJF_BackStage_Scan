#!/bin/bash

# Цвета для вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}📊 Статус системы управления посетителями${NC}"
echo "================================================"

# Проверка статуса контейнеров
echo -e "${YELLOW}🐳 Статус контейнеров:${NC}"
if docker-compose ps | grep -q "Up"; then
    docker-compose ps
    echo
else
    echo -e "${RED}❌ Контейнеры не запущены${NC}"
    echo
fi

# Проверка здоровья базы данных
echo -e "${YELLOW}🗄️  Проверка базы данных:${NC}"
if docker-compose exec -T postgres pg_isready -U visitor_admin -d visitor_system >/dev/null 2>&1; then
    echo -e "${GREEN}✅ База данных доступна${NC}"

    # Получаем статистику БД
    DB_STATS=$(docker-compose exec -T postgres psql -U visitor_admin -d visitor_system -t -c "
        SELECT 'Пользователи: ' || COUNT(*) FROM users WHERE is_active = true
        UNION ALL
        SELECT 'Посетители: ' || COUNT(*) FROM visitors
        UNION ALL
        SELECT 'Сканирования сегодня: ' || COUNT(*) FROM scans WHERE scan_date = CURRENT_DATE;
    " 2>/dev/null)

    if [ $? -eq 0 ]; then
        echo "$DB_STATS"
    fi
else
    echo -e "${RED}❌ База данных недоступна${NC}"
fi

echo

# Проверка здоровья приложения
echo -e "${YELLOW}🌐 Проверка приложения:${NC}"
if curl -s http://localhost:3000/api/admin/health >/dev/null 2>&1; then
    echo -e "${GREEN}✅ Приложение доступно: http://localhost:3000${NC}"

    # Получаем информацию о здоровье
    HEALTH_INFO=$(curl -s http://localhost:3000/api/admin/health | grep -o '"healthy":[^,]*' | cut -d':' -f2)
    if [ "$HEALTH_INFO" = "true" ]; then
        echo -e "${GREEN}✅ Система здорова${NC}"
    else
        echo -e "${YELLOW}⚠️  Система частично работает${NC}"
    fi
else
    echo -e "${RED}❌ Приложение недоступно${NC}"
fi

echo

# Проверка использования ресурсов
echo -e "${YELLOW}💾 Использование ресурсов:${NC}"
if command -v docker stats --no-stream >/dev/null 2>&1; then
    docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}" $(docker-compose ps -q) 2>/dev/null | head -10
else
    echo "Docker stats недоступен"
fi

echo

# Проверка логов на ошибки
echo -e "${YELLOW}📋 Последние ошибки в логах:${NC}"
ERROR_LOGS=$(docker-compose logs --tail=50 2>/dev/null | grep -i "error\|failed\|exception" | tail -5)
if [ -n "$ERROR_LOGS" ]; then
    echo -e "${RED}❌ Найдены ошибки:${NC}"
    echo "$ERROR_LOGS"
else
    echo -e "${GREEN}✅ Критических ошибок не найдено${NC}"
fi

echo

# Проверка портов
echo -e "${YELLOW}🔌 Занятые порты:${NC}"
if command -v lsof >/dev/null 2>&1; then
    lsof -i :3000 -i :5432 2>/dev/null | grep LISTEN || echo "Порты 3000 и 5432 свободны"
elif command -v netstat >/dev/null 2>&1; then
    netstat -tlnp 2>/dev/null | grep -E ":3000|:5432" || echo "Порты 3000 и 5432 свободны"
else
    echo "Невозможно проверить порты"
fi

echo
echo -e "${BLUE}💡 Полезные команды:${NC}"
echo "   docker-compose logs -f     # Просмотр логов в реальном времени"
echo "   docker-compose restart     # Перезапуск всех сервисов"
echo "   ./stop.sh                  # Остановить систему"
echo "   ./start.sh                 # Запустить систему"