// js/stats.js - Модуль отображения статистики
const stats = {
    currentPeriod: 'week',
    refreshInterval: null,

    // Инициализация
    async init() {
        await this.loadStats();
        this.setupEventListeners();
    },

    // Настройка обработчиков событий
    setupEventListeners() {
        const periodSelect = document.getElementById('period-select');
        if (periodSelect) {
            periodSelect.addEventListener('change', this.changePeriod.bind(this));
        }
    },

    // Загрузка статистики
    async loadStats() {
        try {
            // Загружаем основную статистику
            await Promise.all([
                this.loadOverviewStats(),
                this.loadEventsStats(),
                this.loadDailyActivity(),
                this.loadTopVisitors(),
                this.loadScanTypes(),
                this.loadRecentActivity()
            ]);

            this.updateLastUpdate();

        } catch (err) {
            console.error('Ошибка загрузки статистики:', err);
            this.displayError('Ошибка загрузки статистики');
        }
    },

    // Загрузка общей статистики
    async loadOverviewStats() {
        try {
            const response = await fetch('/api/visitors/stats/overview');
            const data = await response.json();

            if (response.ok) {
                this.updateOverviewCards(data);
            } else {
                throw new Error(data.error);
            }
        } catch (err) {
            console.error('Ошибка загрузки общей статистики:', err);
        }
    },

    // Обновление карточек общей статистики
    updateOverviewCards(data) {
        const visitors = data.visitors || {};
        const scans = data.scans || {};

        this.updateStatCard('total-visitors', visitors.total_visitors || 0);
        this.updateStatCard('active-visitors', visitors.active_visitors || 0);
        this.updateStatCard('today-scans', scans.today_scans || 0);
        this.updateStatCard('total-scans', scans.total_scans || 0);
    },

    // Обновление отдельной карточки статистики
    updateStatCard(elementId, value) {
        const element = document.getElementById(elementId);
        if (element) {
            // Анимированное обновление числа
            this.animateNumber(element, parseInt(value) || 0);
        }
    },

    // Анимация изменения числа
    animateNumber(element, targetValue) {
        const currentValue = parseInt(element.textContent) || 0;
        const difference = targetValue - currentValue;
        const duration = 1000; // 1 секунда
        const steps = 20;
        const stepValue = difference / steps;
        const stepDuration = duration / steps;

        let currentStep = 0;

        const timer = setInterval(() => {
            currentStep++;
            const newValue = currentValue + (stepValue * currentStep);

            if (currentStep >= steps) {
                element.textContent = targetValue;
                clearInterval(timer);
            } else {
                element.textContent = Math.round(newValue);
            }
        }, stepDuration);
    },

    // Загрузка статистики по событиям
    async loadEventsStats() {
        try {
            const response = await fetch('/api/events?active_only=false');
            const data = await response.json();

            if (response.ok) {
                this.updateEventsTable(data.events || []);
            } else {
                throw new Error(data.error);
            }
        } catch (err) {
            console.error('Ошибка загрузки статистики событий:', err);
            this.updateEventsTable([]);
        }
    },

    // Обновление таблицы событий
    updateEventsTable(events) {
        const tbody = document.querySelector('#events-stats-table tbody');
        if (!tbody) return;

        if (events.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="loading-cell">Нет данных о событиях</td></tr>';
            return;
        }

        const rows = events.slice(0, 10).map(event => {
            const stats = event.stats || {};
            return `
                <tr>
                    <td>
                        <strong>${event.name}</strong>
                        <br><small>${utils.formatDate(event.start_date)} - ${utils.formatDate(event.end_date)}</small>
                    </td>
                    <td>${stats.total_visitors || 0}</td>
                    <td>${stats.total_scans || 0}</td>
                    <td>${stats.today_scans || 0}</td>
                    <td><span class="status-${event.status}">${utils.getStatusText(event.status)}</span></td>
                </tr>
            `;
        }).join('');

        tbody.innerHTML = rows;
    },

    // Загрузка активности по дням
    async loadDailyActivity() {
        try {
            const endDate = new Date().toISOString().split('T')[0];
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - 7);
            const startDateStr = startDate.toISOString().split('T')[0];

            const response = await fetch(`/api/scan/stats/detailed?date_from=${startDateStr}&date_to=${endDate}`);
            const data = await response.json();

            if (response.ok) {
                this.updateDailyActivityTable(data.daily || []);
            } else {
                throw new Error(data.error);
            }
        } catch (err) {
            console.error('Ошибка загрузки активности по дням:', err);
            this.updateDailyActivityTable([]);
        }
    },

    // Обновление таблицы активности по дням
    updateDailyActivityTable(dailyData) {
        const tbody = document.querySelector('#daily-activity-table tbody');
        if (!tbody) return;

        if (dailyData.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="loading-cell">Нет данных за выбранный период</td></tr>';
            return;
        }

        const rows = dailyData.slice(-7).reverse().map(day => `
            <tr>
                <td>${utils.formatDate(day.date)}</td>
                <td>${day.scanCount || 0}</td>
                <td>${day.uniqueVisitors || 0}</td>
                <td>${day.firstScans || 0}</td>
            </tr>
        `).join('');

        tbody.innerHTML = rows;
    },

    // Загрузка активности по часам (только для сегодня)
    async loadHourlyActivity() {
        const hourlySection = document.getElementById('hourly-stats-section');
        if (!hourlySection || this.currentPeriod !== 'today') {
            if (hourlySection) hourlySection.classList.add('hidden');
            return;
        }

        try {
            const today = new Date().toISOString().split('T')[0];
            const response = await fetch(`/api/scan/stats/daily?date=${today}`);
            const data = await response.json();

            if (response.ok) {
                this.updateHourlyActivityTable(data.hourly || []);
                hourlySection.classList.remove('hidden');
            } else {
                throw new Error(data.error);
            }
        } catch (err) {
            console.error('Ошибка загрузки активности по часам:', err);
            hourlySection.classList.add('hidden');
        }
    },

    // Обновление таблицы активности по часам
    updateHourlyActivityTable(hourlyData) {
        const tbody = document.querySelector('#hourly-activity-table tbody');
        if (!tbody) return;

        if (hourlyData.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" class="loading-cell">Нет данных за сегодня</td></tr>';
            return;
        }

        const rows = hourlyData.map(hour => `
            <tr>
                <td>${hour.hour}:00 - ${hour.hour}:59</td>
                <td>${hour.scanCount || 0}</td>
                <td>${hour.uniqueVisitors || 0}</td>
            </tr>
        `).join('');

        tbody.innerHTML = rows;
    },

    // Загрузка топ посетителей
    async loadTopVisitors() {
        try {
            const period = this.currentPeriod === 'today' ? '1' :
                this.currentPeriod === 'week' ? '7' :
                    this.currentPeriod === 'month' ? '30' : '7';

            const response = await fetch(`/api/scan/stats/top-activity?period=${period}&limit=10`);
            const data = await response.json();

            if (response.ok) {
                this.updateTopVisitorsTable(data.topVisitors || []);
            } else {
                throw new Error(data.error);
            }
        } catch (err) {
            console.error('Ошибка загрузки топ посетителей:', err);
            this.updateTopVisitorsTable([]);
        }
    },

    // Обновление таблицы топ посетителей
    updateTopVisitorsTable(topVisitors) {
        const tbody = document.querySelector('#top-visitors-table tbody');
        if (!tbody) return;

        if (topVisitors.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="loading-cell">Нет активных посетителей</td></tr>';
            return;
        }

        const rows = topVisitors.map((visitor, index) => `
            <tr>
                <td>${index + 1}</td>
                <td>${visitor.name}</td>
                <td>${visitor.eventName || 'Не указано'}</td>
                <td>${visitor.scanCount || 0}</td>
                <td>${visitor.lastScan ? utils.formatDateTime(visitor.lastScan) : 'Никогда'}</td>
            </tr>
        `).join('');

        tbody.innerHTML = rows;
    },

    // Загрузка статистики типов сканирований
    async loadScanTypes() {
        try {
            const endDate = new Date().toISOString().split('T')[0];
            const startDate = new Date();

            if (this.currentPeriod === 'today') {
                startDate.setDate(startDate.getDate());
            } else if (this.currentPeriod === 'week') {
                startDate.setDate(startDate.getDate() - 7);
            } else if (this.currentPeriod === 'month') {
                startDate.setDate(startDate.getDate() - 30);
            } else {
                startDate.setDate(startDate.getDate() - 7);
            }

            const startDateStr = startDate.toISOString().split('T')[0];

            const response = await fetch(`/api/scan/stats/detailed?date_from=${startDateStr}&date_to=${endDate}`);
            const data = await response.json();

            if (response.ok) {
                this.updateScanTypesStats(data.summary || {});
            } else {
                throw new Error(data.error);
            }
        } catch (err) {
            console.error('Ошибка загрузки типов сканирований:', err);
            this.updateScanTypesStats({});
        }
    },

    // Обновление статистики типов сканирований
    updateScanTypesStats(summary) {
        this.updateStatCard('first-scans', summary.first_scans || 0);
        this.updateStatCard('repeat-scans', summary.repeat_scans || 0);
        this.updateStatCard('duplicate-scans', summary.duplicate_scans || 0);
        this.updateStatCard('blocked-attempts', summary.blocked_attempts || 0);
    },

    // Загрузка последней активности
    async loadRecentActivity() {
        try {
            const response = await fetch('/api/visitors/stats/overview');
            const data = await response.json();

            if (response.ok) {
                this.updateRecentActivity(data.recentActivity || []);
            } else {
                throw new Error(data.error);
            }
        } catch (err) {
            console.error('Ошибка загрузки последней активности:', err);
            this.updateRecentActivity([]);
        }
    },

    // Обновление последней активности
    updateRecentActivity(activities) {
        const container = document.querySelector('#recent-activity .activity-list');
        if (!container) return;

        if (activities.length === 0) {
            container.innerHTML = '<div class="loading">Нет последней активности</div>';
            return;
        }

        const activitiesHtml = activities.slice(0, 10).map(activity => {
            const icon = this.getScanTypeIcon(activity.scan_type);
            const visitorName = `${activity.last_name} ${activity.first_name} ${activity.middle_name || ''}`.trim();

            return `
                <div class="activity-item">
                    <div class="activity-icon">${icon}</div>
                    <div class="activity-details">
                        <div class="activity-text">
                            <strong>${visitorName}</strong>
                            ${activity.event_name ? `• ${activity.event_name}` : ''}
                        </div>
                        <div class="activity-time">
                            ${utils.formatDateTime(activity.scanned_at)}
                            ${activity.scanned_by_name ? `• ${activity.scanned_by_name}` : ''}
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        container.innerHTML = activitiesHtml;
    },

    // Получение иконки для типа сканирования
    getScanTypeIcon(scanType) {
        const icons = {
            'first': '🆕',
            'repeat': '🔄',
            'duplicate': '⚠️',
            'blocked_attempt': '🚫',
            'batch': '📦'
        };
        return icons[scanType] || '📱';
    },

    // Изменение периода
    async changePeriod() {
        const periodSelect = document.getElementById('period-select');
        if (periodSelect) {
            this.currentPeriod = periodSelect.value;
            await this.loadStats();

            // Показываем/скрываем почасовую статистику
            if (this.currentPeriod === 'today') {
                await this.loadHourlyActivity();
            } else {
                const hourlySection = document.getElementById('hourly-stats-section');
                if (hourlySection) hourlySection.classList.add('hidden');
            }
        }
    },

    // Обновление всей статистики
    async refresh() {
        await this.loadStats();
        utils.showAlert('success', 'Статистика обновлена');
    },

    // Тихое обновление (без уведомлений)
    async refreshQuietly() {
        try {
            await this.loadOverviewStats();
            await this.loadRecentActivity();
            this.updateLastUpdate();
        } catch (err) {
            console.error('Ошибка тихого обновления:', err);
        }
    },

    // Экспорт статистики (заглушка)
    async exportStats() {
        utils.showAlert('info', 'Функция экспорта статистики будет добавлена в следующем обновлении');
    },

    // Обновление времени последнего обновления
    updateLastUpdate() {
        const element = document.getElementById('last-update');
        if (element) {
            element.textContent = new Date().toLocaleString('ru-RU');
        }
    },

    // Отображение ошибки
    displayError(message) {
        const overviewStats = document.getElementById('overview-stats');
        if (overviewStats) {
            overviewStats.innerHTML = `
                <div style="text-align: center; padding: 40px; color: #dc3545; grid-column: 1 / -1;">
                    <h3>❌ ${message}</h3>
                    <button onclick="stats.refresh()" class="primary-btn" style="margin-top: 15px;">
                        🔄 Попробовать снова
                    </button>
                </div>
            `;
        }
    }
};