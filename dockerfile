# Используем официальный Node.js образ
FROM node:18-alpine

# Устанавливаем рабочую директорию
WORKDIR /app

# Устанавливаем зависимости системы, включая postgresql-client для скриптов бэкапа
RUN apk add --no-cache \
    curl \
    postgresql-client \
    python3 \
    make \
    g++

# Копируем package.json и package-lock.json (если есть)
COPY package*.json ./

# Устанавливаем зависимости
RUN npm ci --only=production && npm cache clean --force

# Создаем пользователя для безопасности
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodeuser -u 1001

# Создаем необходимые директории и устанавливаем права
RUN mkdir -p uploads/photos uploads/qr-codes public scripts && \
    chown -R nodeuser:nodejs /app

# Копируем исходный код приложения
COPY --chown=nodeuser:nodejs . .

# Переключаемся на пользователя nodejs
USER nodeuser

# Открываем порт
EXPOSE 3000

# Добавляем healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:3000/api/admin/health || exit 1

# Запускаем приложение
CMD ["npm", "start"]