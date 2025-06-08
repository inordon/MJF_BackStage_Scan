#!/bin/bash

# Цвета для вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🛑 Остановка системы управления посетителями${NC}"
echo "================================================"

# Проверяем параметры командной строки
CLEAN_VOLUMES=false
CLEAN_IMAGES=false

for arg in "$@"; do
    case $arg in
        --volumes)
            CLEAN_VOLUMES=true
            shift
            ;;
        --images)
            CLEAN_IMAGES=true
            shift
            ;;
        --all)
            CLEAN_VOLUMES=true
            CLEAN_IMAGES=true
            shift
            ;;
        --help|-h)
            echo "Использование: $0 [--volumes] [--images] [--all]"
            echo "  --volumes    Удалить тома данных"
            echo "  --images     Удалить образы"
            echo "  --all        Удалить всё (volumes + images)"
            exit 0
            ;;
    esac
done

# Останавливаем контейнеры
echo -e "${YELLOW}⏹️  Остановка контейнеров...${NC}"
docker-compose down

# Удаляем контейнеры принудительно
echo -e "${YELLOW}🗑️  Удаление контейнеров...${NC}"
docker rm -f visitor_db visitor_app 2>/dev/null || true

# Удаляем volumes если указан флаг
if [ "$CLEAN_VOLUMES" = true ]; then
    echo -e "${YELLOW}💾 Удаление volumes (данные будут потеряны!)...${NC}"
    read -p "Вы уверены? Все данные в базе будут удалены! (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        docker-compose down -v
        docker volume rm visitor-management-system_postgres_data 2>/dev/null || true
        echo -e "${GREEN}✅ Volumes удалены${NC}"
    else
        echo -e "${BLUE}ℹ️  Volumes оставлены${NC}"
    fi
fi

# Удаляем образы если указан флаг
if [ "$CLEAN_IMAGES" = true ]; then
    echo -e "${YELLOW}🖼️  Удаление образов...${NC}"
    docker rmi visitor-management-system_app 2>/dev/null || true
    docker image prune -f 2>/dev/null || true
    echo -e "${GREEN}✅ Образы удалены${NC}"
fi

# Показываем статус
echo
echo -e "${GREEN}✅ Система остановлена${NC}"

# Проверяем что всё остановлено
RUNNING_CONTAINERS=$(docker ps -q --filter "name=visitor")
if [ -z "$RUNNING_CONTAINERS" ]; then
    echo -e "${GREEN}🎯 Все контейнеры остановлены${NC}"
else
    echo -e "${YELLOW}⚠️  Некоторые контейнеры всё ещё работают:${NC}"
    docker ps --filter "name=visitor"
fi

echo
echo -e "${BLUE}💡 Подсказки:${NC}"
echo "   ./start.sh                 # Запустить систему заново"
echo "   ./stop.sh --volumes        # Остановить + удалить данные"
echo "   ./stop.sh --all            # Полная очистка"
echo "   docker system prune -a     # Очистить всё Docker"