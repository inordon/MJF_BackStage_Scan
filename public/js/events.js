// js/events.js - Модуль управления событиями
const events = {
    currentPage: 1,
    totalPages: 1,
    filters: {
        status: '',
        search: ''
    },

    // Инициализация
    async init() {
        await this.loadList();
        this.setupEventListeners();
    },

    // Настройка обработчиков событий
    setupEventListeners() {
        const form = document.getElementById('event-form');
        if (form) {
            form.addEventListener('submit', this.handleFormSubmit.bind(this));
        }
    },

    // Загрузка списка событий
    async loadList(page = 1) {
        try {
            const params = new URLSearchParams({
                page: page,
                limit: 20,
                ...this.filters
            });

            const response = await fetch(`/api/events?${params}`);
            const data = await response.json();

            this.displayEvents(data.events);
            this.updatePagination(data.pagination);
            this.updateStats(data.events);

        } catch (err) {
            console.error('Ошибка загрузки событий:', err);
            this.displayError('Ошибка загрузки списка событий');
        }
    },

    // Отображение событий
    displayEvents(eventsList) {
        const container = document.getElementById('events-list');
        if (!container) return;

        if (!eventsList || eventsList.length === 0) {
            container.innerHTML = '<div class="empty">События не найдены</div>';
            return;
        }

        const eventsHtml = eventsList.map(event => {
            const stats = event.stats || {};
            const isActive = event.status === 'active';
            const isPast = new Date(event.end_date) < new Date();

            return `
                <div class="event-card">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                        <div style="flex: 1;">
                            <h3>${event.name}</h3>
                            ${event.description ? `<p style="color: #666; margin: 8px 0;">${event.description}</p>` : ''}
                        </div>
                        <span class="status-${event.status}">${utils.getStatusText(event.status)}</span>
                    </div>

                    <div class="event-meta">
                        <div>
                            <strong>📅 Период:</strong><br>
                            ${utils.formatDate(event.start_date)} - ${utils.formatDate(event.end_date)}
                        </div>
                        ${event.location ? `
                            <div>
                                <strong>📍 Место:</strong><br>
                                ${event.location}
                            </div>
                        ` : ''}
                        <div>
                            <strong>👥 Регистрация:</strong><br>
                            ${event.registration_required ? 'Требуется' : 'Свободная'}
                        </div>
                        ${event.max_participants ? `
                            <div>
                                <strong>👤 Максимум:</strong><br>
                                ${event.max_participants} человек
                            </div>
                        ` : ''}
                    </div>

                    <div class="event-stats">
                        <span title="Всего посетителей">👥 ${stats.total_visitors || 0}</span>
                        <span title="Активных посетителей">✅ ${stats.active_visitors || 0}</span>
                        <span title="Заблокированных">🚫 ${stats.blocked_visitors || 0}</span>
                        <span title="Всего сканирований">📱 ${stats.total_scans || 0}</span>
                        <span title="Сканирований сегодня">📅 ${stats.today_scans || 0}</span>
                        <span title="Уникальных посетителей">🔍 ${stats.unique_visitors_scanned || 0}</span>
                    </div>

                    <div class="event-actions">
                        <button onclick="events.viewDetails(${event.id})" class="secondary-btn">
                            👁️ Подробнее
                        </button>
                        <button onclick="events.viewVisitors(${event.id})" class="secondary-btn">
                            👥 Посетители
                        </button>
                        ${auth.hasRole(['admin', 'moderator']) ? `
                            <button onclick="events.editEvent(${event.id})" class="secondary-btn">
                                ✏️ Редактировать
                            </button>
                            ${isActive && !isPast ? `
                                <button onclick="events.changeStatus(${event.id}, 'inactive')" class="secondary-btn">
                                    ⏸️ Приостановить
                                </button>
                            ` : ''}
                            ${!isActive && !isPast ? `
                                <button onclick="events.changeStatus(${event.id}, 'active')" class="secondary-btn">
                                    ▶️ Активировать
                                </button>
                            ` : ''}
                            ${isPast && isActive ? `
                                <button onclick="events.changeStatus(${event.id}, 'completed')" class="secondary-btn">
                                    ✅ Завершить
                                </button>
                            ` : ''}
                        ` : ''}
                    </div>

                    <div style="margin-top: 15px; font-size: 12px; color: #888;">
                        Создано: ${utils.formatDate(event.created_at)}
                        ${event.created_by_name ? ` • ${event.created_by_name}` : ''}
                    </div>
                </div>
            `;
        }).join('');

        container.innerHTML = eventsHtml;
    },

    // Обновление статистики
    updateStats(eventsList) {
        const statsContainer = document.getElementById('events-stats');
        if (!statsContainer || !eventsList) return;

        const totalEvents = eventsList.length;
        const activeEvents = eventsList.filter(e => e.status === 'active').length;
        const totalVisitors = eventsList.reduce((sum, e) => sum + (e.stats?.total_visitors || 0), 0);
        const totalScans = eventsList.reduce((sum, e) => sum + (e.stats?.total_scans || 0), 0);

        document.getElementById('total-events').textContent = totalEvents;
        document.getElementById('active-events').textContent = activeEvents;
        document.getElementById('total-visitors').textContent = totalVisitors;
        document.getElementById('total-scans').textContent = totalScans;

        statsContainer.classList.remove('hidden');
    },

    // Обновление пагинации
    updatePagination(pagination) {
        this.currentPage = pagination.page;
        this.totalPages = pagination.pages;

        utils.renderPagination('events-pagination', pagination, 'events.loadList');
    },

    // Показ формы создания
    showCreateForm() {
        const modal = document.getElementById('create-event-modal');
        if (modal) {
            modal.classList.remove('hidden');

            // Устанавливаем минимальные даты
            const today = new Date().toISOString().split('T')[0];
            const startDateInput = document.getElementById('start-date');
            const endDateInput = document.getElementById('end-date');

            if (startDateInput) startDateInput.min = today;
            if (endDateInput) endDateInput.min = today;
        }
    },

    // Скрытие формы создания
    hideCreateForm() {
        const modal = document.getElementById('create-event-modal');
        const form = document.getElementById('event-form');

        if (modal) modal.classList.add('hidden');
        if (form) form.reset();
    },

    // Обработка отправки формы
    async handleFormSubmit(e) {
        e.preventDefault();

        const submitBtn = e.target.querySelector('button[type="submit"]');
        const btnText = submitBtn.querySelector('.btn-text');
        const btnLoading = submitBtn.querySelector('.btn-loading');

        try {
            // Показываем индикатор загрузки
            submitBtn.disabled = true;
            btnText.classList.add('hidden');
            btnLoading.classList.remove('hidden');

            const formData = new FormData(e.target);
            const eventData = {
                name: formData.get('name'),
                description: formData.get('description'),
                start_date: formData.get('start_date'),
                end_date: formData.get('end_date'),
                location: formData.get('location'),
                max_participants: formData.get('max_participants') ? parseInt(formData.get('max_participants')) : null,
                registration_required: formData.has('registration_required')
            };

            const response = await fetch('/api/events', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(eventData)
            });

            const data = await response.json();

            if (response.ok) {
                utils.showAlert('success', 'Событие успешно создано!');
                this.hideCreateForm();
                this.loadList(1);
            } else {
                throw new Error(data.error || 'Ошибка создания события');
            }

        } catch (err) {
            console.error('Ошибка создания события:', err);
            utils.showAlert('error', err.message);
        } finally {
            // Возвращаем кнопку в исходное состояние
            submitBtn.disabled = false;
            btnText.classList.remove('hidden');
            btnLoading.classList.add('hidden');
        }
    },

    // Просмотр деталей события
    async viewDetails(eventId) {
        try {
            const response = await fetch(`/api/events/${eventId}`);
            const event = await response.json();

            if (!response.ok) {
                throw new Error(event.error || 'Ошибка загрузки события');
            }

            this.showDetailsModal(event);

        } catch (err) {
            console.error('Ошибка загрузки деталей события:', err);
            utils.showAlert('error', 'Ошибка загрузки деталей события');
        }
    },

    // Показ модального окна с деталями
    showDetailsModal(event) {
        const modal = document.getElementById('event-details-modal');
        const title = document.getElementById('event-details-title');
        const content = document.getElementById('event-details-content');

        if (!modal || !title || !content) return;

        title.textContent = event.name;

        const stats = event.stats || {};
        const isPast = new Date(event.end_date) < new Date();

        content.innerHTML = `
            <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 30px; margin-bottom: 25px;">
                <div>
                    <h4>📋 Основная информация</h4>
                    <div style="background: #f8f9fa; padding: 20px; border-radius: 12px; margin-top: 15px;">
                        <p><strong>Название:</strong> ${event.name}</p>
                        ${event.description ? `<p><strong>Описание:</strong> ${event.description}</p>` : ''}
                        <p><strong>Период:</strong> ${utils.formatDate(event.start_date)} - ${utils.formatDate(event.end_date)}</p>
                        ${event.location ? `<p><strong>Место:</strong> ${event.location}</p>` : ''}
                        <p><strong>Статус:</strong> <span class="status-${event.status}">${utils.getStatusText(event.status)}</span></p>
                        <p><strong>Регистрация:</strong> ${event.registration_required ? 'Требуется' : 'Свободная'}</p>
                        ${event.max_participants ? `<p><strong>Максимум участников:</strong> ${event.max_participants}</p>` : ''}
                    </div>
                </div>

                <div>
                    <h4>📊 Статистика</h4>
                    <div class="stats-grid" style="grid-template-columns: 1fr; gap: 10px; margin-top: 15px;">
                        <div class="stat-detail-card">
                            <div class="stat-number">${stats.total_visitors || 0}</div>
                            <small>Всего посетителей</small>
                        </div>
                        <div class="stat-detail-card">
                            <div class="stat-number">${stats.active_visitors || 0}</div>
                            <small>Активных</small>
                        </div>
                        <div class="stat-detail-card">
                            <div class="stat-number">${stats.total_scans || 0}</div>
                            <small>Всего сканирований</small>
                        </div>
                        <div class="stat-detail-card">
                            <div class="stat-number">${stats.today_scans || 0}</div>
                            <small>Сегодня</small>
                        </div>
                    </div>
                </div>
            </div>

            <div>
                <h4>ℹ️ Системная информация</h4>
                <div style="background: #f8f9fa; padding: 20px; border-radius: 12px; margin-top: 15px; font-size: 14px;">
                    <p><strong>ID события:</strong> ${event.id}</p>
                    <p><strong>UUID:</strong> <code>${event.event_uuid}</code></p>
                    <p><strong>Создано:</strong> ${utils.formatDateTime(event.created_at)}</p>
                    ${event.created_by_name ? `<p><strong>Создал:</strong> ${event.created_by_name}</p>` : ''}
                    ${event.updated_at && event.updated_at !== event.created_at ? `
                        <p><strong>Обновлено:</strong> ${utils.formatDateTime(event.updated_at)}</p>
                        ${event.updated_by_name ? `<p><strong>Обновил:</strong> ${event.updated_by_name}</p>` : ''}
                    ` : ''}
                </div>
            </div>

            <div style="margin-top: 25px; display: flex; gap: 15px; flex-wrap: wrap;">
                <button onclick="events.viewVisitors(${event.id})" class="primary-btn">
                    👥 Посетители события
                </button>
                ${auth.hasRole(['admin', 'moderator']) ? `
                    <button onclick="events.editEvent(${event.id})" class="secondary-btn">
                        ✏️ Редактировать
                    </button>
                ` : ''}
                <button onclick="events.hideDetailsModal()" class="secondary-btn">
                    ❌ Закрыть
                </button>
            </div>
        `;

        modal.classList.remove('hidden');
    },

    // Скрытие модального окна деталей
    hideDetailsModal() {
        const modal = document.getElementById('event-details-modal');
        if (modal) modal.classList.add('hidden');
    },

    // Просмотр посетителей события
    viewVisitors(eventId) {
        window.location.href = `/?event_id=${eventId}`;
    },

    // Редактирование события (заглушка)
    async editEvent(eventId) {
        utils.showAlert('info', 'Функция редактирования событий будет добавлена в следующем обновлении');
    },

    // Изменение статуса события
    async changeStatus(eventId, newStatus) {
        const statusText = {
            'active': 'активировать',
            'inactive': 'приостановить',
            'completed': 'завершить',
            'cancelled': 'отменить'
        }[newStatus] || 'изменить статус';

        if (!confirm(`Вы уверены, что хотите ${statusText} это событие?`)) {
            return;
        }

        try {
            const response = await fetch(`/api/events/${eventId}/status`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus })
            });

            const data = await response.json();

            if (response.ok) {
                utils.showAlert('success', data.message);
                this.loadList(this.currentPage);
            } else {
                throw new Error(data.error);
            }
        } catch (err) {
            utils.showAlert('error', 'Ошибка изменения статуса: ' + err.message);
        }
    },

    // Фильтрация
    filter() {
        this.filters.status = document.getElementById('status-filter')?.value || '';
        this.filters.search = document.getElementById('search-input')?.value || '';

        this.loadList(1);
    },

    // Сброс фильтров
    resetFilters() {
        const statusFilter = document.getElementById('status-filter');
        const searchInput = document.getElementById('search-input');

        if (statusFilter) statusFilter.value = '';
        if (searchInput) searchInput.value = '';

        this.filters = { status: '', search: '' };
        this.loadList(1);
    },

    // Обновление списка
    async refresh() {
        await this.loadList(this.currentPage);
        utils.showAlert('success', 'Список событий обновлен');
    },

    // Отображение ошибки
    displayError(message) {
        const container = document.getElementById('events-list');
        if (container) {
            container.innerHTML = `
                <div style="text-align: center; padding: 40px; color: #dc3545;">
                    <h3>❌ ${message}</h3>
                    <button onclick="events.loadList()" class="primary-btn" style="margin-top: 15px;">
                        🔄 Попробовать снова
                    </button>
                </div>
            `;
        }
    }
};