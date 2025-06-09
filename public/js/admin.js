// js/admin.js - Упрощенный модуль администрирования
const admin = {
    currentPage: 1,
    totalPages: 1,
    users: [],
    filters: {
        role: '',
        active_only: ''
    },

    // Инициализация модуля
    async init() {
        console.log('👑 Инициализация модуля администрирования');

        await this.loadUsers();
        await this.loadSystemStats();
        this.setupEventListeners();

        // Автообновление каждые 30 секунд
        this.startAutoRefresh();
    },

    // Настройка обработчиков событий
    setupEventListeners() {
        const userForm = document.getElementById('user-form');
        const editUserForm = document.getElementById('edit-user-form');

        if (userForm) {
            userForm.addEventListener('submit', this.handleCreateUser.bind(this));
        }

        if (editUserForm) {
            editUserForm.addEventListener('submit', this.handleEditUser.bind(this));
        }
    },

    // Загрузка списка пользователей
    async loadUsers(page = 1) {
        try {
            console.log('👥 Загрузка пользователей, страница:', page);

            const params = new URLSearchParams({
                page: page,
                limit: 25,
                ...this.filters
            });

            const response = await fetch(`/api/admin/users?${params}`);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();

            this.users = data.users;
            this.displayUsers(data.users);
            this.updatePagination(data.pagination);
            this.updateUsersCount(data.pagination.total);

        } catch (err) {
            console.error('❌ Ошибка загрузки пользователей:', err);
            this.displayError('Ошибка загрузки пользователей: ' + err.message);
        }
    },

    // Отображение списка пользователей
    displayUsers(users) {
        const container = document.getElementById('users-table');
        if (!container) return;

        if (!users || users.length === 0) {
            container.innerHTML = '<div class="empty">Пользователи не найдены</div>';
            return;
        }

        const table = `
            <table>
                <thead>
                    <tr>
                        <th>Пользователь</th>
                        <th>Роль</th>
                        <th>Email</th>
                        <th>Статус</th>
                        <th>Последний вход</th>
                        <th>Создан</th>
                        <th>Действия</th>
                    </tr>
                </thead>
                <tbody>
                    ${users.map(user => `
                        <tr data-user-id="${user.id}">
                            <td>
                                <strong>${user.fullName}</strong>
                                <br><small style="color: #666;">@${user.username}</small>
                            </td>
                            <td>
                                <span class="role-${user.role}">
                                    ${this.getRoleIcon(user.role)} ${utils.getRoleText(user.role)}
                                </span>
                            </td>
                            <td>
                                ${user.email ?
            `<a href="mailto:${user.email}" style="color: #007bff;">${user.email}</a>` :
            '<span style="color: #999;">Не указан</span>'
        }
                            </td>
                            <td>
                                <span class="status-${user.isActive ? 'active' : 'blocked'}">
                                    ${user.isActive ? '✅ Активен' : '🚫 Заблокирован'}
                                </span>
                            </td>
                            <td>
                                ${user.lastLogin ?
            utils.formatDateTime(user.lastLogin) :
            '<span style="color: #999;">Никогда</span>'
        }
                            </td>
                            <td>
                                ${utils.formatDate(user.createdAt)}
                                ${user.createdByName ?
            `<br><small style="color: #666;">${user.createdByName}</small>` : ''
        }
                            </td>
                            <td>
                                <div style="display: flex; gap: 4px; flex-wrap: wrap;">
                                    <button onclick="admin.editUser(${user.id})" 
                                            class="secondary-btn" 
                                            title="Редактировать"
                                            style="padding: 6px 8px; font-size: 12px;">
                                        ✏️
                                    </button>
                                    ${user.username !== auth.currentUser?.username ? `
                                        <button onclick="admin.resetPassword(${user.id})" 
                                                class="secondary-btn" 
                                                title="Сброс пароля"
                                                style="padding: 6px 8px; font-size: 12px;">
                                            🔑
                                        </button>
                                        <button onclick="admin.toggleUserStatus(${user.id}, ${user.isActive})" 
                                                class="secondary-btn" 
                                                title="${user.isActive ? 'Заблокировать' : 'Разблокировать'}"
                                                style="padding: 6px 8px; font-size: 12px;">
                                            ${user.isActive ? '🚫' : '✅'}
                                        </button>
                                        <button onclick="admin.deleteUser(${user.id})" 
                                                class="secondary-btn" 
                                                title="Удалить"
                                                style="padding: 6px 8px; font-size: 12px; background: #dc3545;">
                                            🗑️
                                        </button>
                                    ` : '<small style="color: #999;">Текущий</small>'}
                                </div>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;

        container.innerHTML = table;
    },

    // Получение иконки роли
    getRoleIcon(role) {
        const icons = {
            'admin': '👑',
            'moderator': '⚙️',
            'skd': '🔒'
        };
        return icons[role] || '👤';
    },

    // Обновление счетчика пользователей
    updateUsersCount(total) {
        const counter = document.getElementById('users-count');
        if (counter) {
            counter.textContent = `${total} пользователей`;
        }
    },

    // Обновление пагинации
    updatePagination(pagination) {
        this.currentPage = pagination.page;
        this.totalPages = pagination.pages;

        utils.renderPagination('users-pagination', pagination, 'admin.loadUsers');
    },

    // Создание пользователя
    async handleCreateUser(e) {
        e.preventDefault();

        const submitBtn = e.target.querySelector('button[type="submit"]');
        const btnText = submitBtn.querySelector('.btn-text');
        const btnLoading = submitBtn.querySelector('.btn-loading');

        try {
            submitBtn.disabled = true;
            btnText.classList.add('hidden');
            btnLoading.classList.remove('hidden');

            const formData = new FormData(e.target);
            const userData = {
                username: formData.get('username'),
                password: formData.get('password'),
                fullName: formData.get('fullName'),
                role: formData.get('role'),
                email: formData.get('email') || null
            };

            const response = await fetch('/api/admin/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(userData)
            });

            const data = await response.json();

            if (response.ok) {
                utils.showAlert('success', 'Пользователь успешно создан!');
                this.hideCreateUserForm();
                this.loadUsers(1);
            } else {
                throw new Error(data.error || 'Ошибка создания пользователя');
            }

        } catch (err) {
            console.error('❌ Ошибка создания пользователя:', err);
            utils.showAlert('error', err.message);
        } finally {
            submitBtn.disabled = false;
            btnText.classList.remove('hidden');
            btnLoading.classList.add('hidden');
        }
    },

    // Редактирование пользователя
    async editUser(userId) {
        try {
            const user = this.users.find(u => u.id === userId);
            if (!user) {
                utils.showAlert('error', 'Пользователь не найден');
                return;
            }

            // Заполняем форму
            document.getElementById('edit-user-id').value = user.id;
            document.getElementById('edit-username').value = user.username;
            document.getElementById('edit-fullName').value = user.fullName;
            document.getElementById('edit-role').value = user.role;
            document.getElementById('edit-email').value = user.email || '';
            document.getElementById('edit-isActive').checked = user.isActive;

            this.showEditUserForm();

        } catch (err) {
            console.error('❌ Ошибка загрузки данных пользователя:', err);
            utils.showAlert('error', 'Ошибка загрузки данных пользователя');
        }
    },

    // Обработка редактирования пользователя
    async handleEditUser(e) {
        e.preventDefault();

        const submitBtn = e.target.querySelector('button[type="submit"]');
        const btnText = submitBtn.querySelector('.btn-text');
        const btnLoading = submitBtn.querySelector('.btn-loading');

        try {
            submitBtn.disabled = true;
            btnText.classList.add('hidden');
            btnLoading.classList.remove('hidden');

            const userId = document.getElementById('edit-user-id').value;
            const formData = new FormData(e.target);
            const userData = {
                fullName: formData.get('fullName'),
                role: formData.get('role'),
                email: formData.get('email') || null,
                isActive: formData.has('isActive')
            };

            const response = await fetch(`/api/admin/users/${userId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(userData)
            });

            const data = await response.json();

            if (response.ok) {
                utils.showAlert('success', 'Пользователь успешно обновлен!');
                this.hideEditUserForm();
                this.loadUsers(this.currentPage);
            } else {
                throw new Error(data.error || 'Ошибка обновления пользователя');
            }

        } catch (err) {
            console.error('❌ Ошибка обновления пользователя:', err);
            utils.showAlert('error', err.message);
        } finally {
            submitBtn.disabled = false;
            btnText.classList.remove('hidden');
            btnLoading.classList.add('hidden');
        }
    },

    // Сброс пароля пользователя
    async resetPassword(userId) {
        const user = this.users.find(u => u.id === userId);
        if (!user) return;

        const newPassword = prompt(`Введите новый пароль для пользователя "${user.username}":`);
        if (!newPassword || newPassword.length < 6) {
            utils.showAlert('error', 'Пароль должен содержать минимум 6 символов');
            return;
        }

        if (!confirm(`Сбросить пароль пользователя "${user.username}"?`)) {
            return;
        }

        try {
            const response = await fetch(`/api/admin/users/${userId}/reset-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ newPassword })
            });

            const data = await response.json();

            if (response.ok) {
                utils.showAlert('success', 'Пароль успешно сброшен');
            } else {
                throw new Error(data.error);
            }
        } catch (err) {
            utils.showAlert('error', 'Ошибка сброса пароля: ' + err.message);
        }
    },

    // Переключение статуса пользователя
    async toggleUserStatus(userId, currentStatus) {
        const user = this.users.find(u => u.id === userId);
        if (!user) return;

        const action = currentStatus ? 'заблокировать' : 'разблокировать';

        if (!confirm(`Вы уверены, что хотите ${action} пользователя "${user.username}"?`)) {
            return;
        }

        try {
            const response = await fetch(`/api/admin/users/${userId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...user,
                    isActive: !currentStatus
                })
            });

            const data = await response.json();

            if (response.ok) {
                utils.showAlert('success', data.message);
                this.loadUsers(this.currentPage);
            } else {
                throw new Error(data.error);
            }
        } catch (err) {
            utils.showAlert('error', 'Ошибка изменения статуса: ' + err.message);
        }
    },

    // Удаление пользователя
    async deleteUser(userId) {
        const user = this.users.find(u => u.id === userId);
        if (!user) return;

        if (!confirm(`ВНИМАНИЕ! Вы собираетесь удалить пользователя "${user.username}".\n\nЭто действие необратимо. Продолжить?`)) {
            return;
        }

        try {
            const response = await fetch(`/api/admin/users/${userId}`, {
                method: 'DELETE'
            });

            const data = await response.json();

            if (response.ok) {
                utils.showAlert('success', 'Пользователь успешно удален');
                this.loadUsers(this.currentPage);
            } else {
                throw new Error(data.error);
            }
        } catch (err) {
            utils.showAlert('error', 'Ошибка удаления пользователя: ' + err.message);
        }
    },

    // Загрузка системной статистики
    async loadSystemStats() {
        try {
            const response = await fetch('/api/admin/stats');
            const data = await response.json();

            if (response.ok) {
                this.updateSystemStats(data);
            } else {
                console.error('❌ Ошибка загрузки системной статистики:', data.error);
            }
        } catch (err) {
            console.error('❌ Ошибка загрузки системной статистики:', err);
        }
    },

    // Обновление системной статистики
    updateSystemStats(data) {
        const stats = data.database || {};

        this.updateStatElement('total-users',
            parseInt(stats.active_users || 0) + parseInt(stats.inactive_users || 0));
        this.updateStatElement('active-users', stats.active_users || 0);
        this.updateStatElement('total-sessions', stats.active_sessions || 0);
        this.updateStatElement('system-uptime',
            Math.floor((data.system?.uptime || 0) / 3600));
    },

    // Обновление элемента статистики
    updateStatElement(elementId, value) {
        const element = document.getElementById(elementId);
        if (element) {
            element.textContent = value;
        }
    },

    // Фильтрация пользователей
    filterUsers() {
        this.filters.role = document.getElementById('role-filter')?.value || '';
        this.filters.active_only = document.getElementById('active-filter')?.value || '';

        this.loadUsers(1);
    },

    // Сброс фильтров
    resetFilters() {
        const roleFilter = document.getElementById('role-filter');
        const activeFilter = document.getElementById('active-filter');

        if (roleFilter) roleFilter.value = '';
        if (activeFilter) activeFilter.value = '';

        this.filters = { role: '', active_only: '' };
        this.loadUsers(1);
    },

    // Обновление списка пользователей
    async refreshUsers() {
        await this.loadUsers(this.currentPage);
        utils.showAlert('success', 'Список пользователей обновлен');
    },

    // Показ формы создания пользователя
    showCreateUserForm() {
        const modal = document.getElementById('create-user-modal');
        const form = document.getElementById('user-form');

        if (modal) modal.classList.remove('hidden');
        if (form) form.reset();
    },

    // Скрытие формы создания пользователя
    hideCreateUserForm() {
        const modal = document.getElementById('create-user-modal');
        const form = document.getElementById('user-form');

        if (modal) modal.classList.add('hidden');
        if (form) form.reset();
    },

    // Показ формы редактирования пользователя
    showEditUserForm() {
        const modal = document.getElementById('edit-user-modal');
        if (modal) modal.classList.remove('hidden');
    },

    // Скрытие формы редактирования пользователя
    hideEditUserForm() {
        const modal = document.getElementById('edit-user-modal');
        const form = document.getElementById('edit-user-form');

        if (modal) modal.classList.add('hidden');
        if (form) form.reset();
    },

    // Показ системной информации
    async showSystemInfo() {
        const modal = document.getElementById('system-info-modal');
        const content = document.getElementById('system-info-content');

        if (modal) modal.classList.remove('hidden');
        if (content) content.innerHTML = '<div class="loading">Загрузка системной информации...</div>';

        await this.loadSystemInfo();
    },

    // Скрытие системной информации
    hideSystemInfo() {
        const modal = document.getElementById('system-info-modal');
        if (modal) modal.classList.add('hidden');
    },

    // Загрузка системной информации
    async loadSystemInfo() {
        try {
            const response = await fetch('/api/admin/stats');
            const data = await response.json();

            const content = document.getElementById('system-info-content');
            if (!content) return;

            content.innerHTML = `
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 30px;">
                    <div>
                        <h4>🗄️ База данных</h4>
                        <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin-top: 10px;">
                            <p><strong>Активные пользователи:</strong> ${data.database?.active_users || 0}</p>
                            <p><strong>Всего посетителей:</strong> ${data.database?.total_visitors || 0}</p>
                            <p><strong>Активные посетители:</strong> ${data.database?.active_visitors || 0}</p>
                            <p><strong>Сканирования сегодня:</strong> ${data.database?.today_scans || 0}</p>
                            <p><strong>Активные сессии:</strong> ${data.database?.active_sessions || 0}</p>
                        </div>
                    </div>

                    <div>
                        <h4>🖥️ Система</h4>
                        <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin-top: 10px;">
                            <p><strong>Версия Node.js:</strong> ${data.system?.node_version || 'N/A'}</p>
                            <p><strong>Время работы:</strong> ${Math.floor((data.system?.uptime || 0) / 3600)}ч ${Math.floor(((data.system?.uptime || 0) % 3600) / 60)}м</p>
                            <p><strong>Платформа:</strong> ${data.system?.platform || 'N/A'}</p>
                            <p><strong>Архитектура:</strong> ${data.system?.arch || 'N/A'}</p>
                            <p><strong>Память:</strong> ${Math.round((data.system?.memory_usage?.heapUsed || 0) / 1024 / 1024)}MB</p>
                        </div>
                    </div>
                </div>

                <div style="margin-top: 20px;">
                    <h4>📊 Использование памяти</h4>
                    <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin-top: 10px;">
                        <p><strong>Heap Used:</strong> ${Math.round((data.system?.memory_usage?.heapUsed || 0) / 1024 / 1024)}MB</p>
                        <p><strong>Heap Total:</strong> ${Math.round((data.system?.memory_usage?.heapTotal || 0) / 1024 / 1024)}MB</p>
                        <p><strong>RSS:</strong> ${Math.round((data.system?.memory_usage?.rss || 0) / 1024 / 1024)}MB</p>
                        <p><strong>External:</strong> ${Math.round((data.system?.memory_usage?.external || 0) / 1024 / 1024)}MB</p>
                    </div>
                </div>
            `;

        } catch (err) {
            console.error('❌ Ошибка загрузки системной информации:', err);
            const content = document.getElementById('system-info-content');
            if (content) {
                content.innerHTML = `
                    <div style="text-align: center; color: #dc3545; padding: 20px;">
                        ❌ Ошибка загрузки системной информации
                    </div>
                `;
            }
        }
    },

    // Обновление системной информации
    async refreshSystemInfo() {
        await this.loadSystemInfo();
        utils.showAlert('success', 'Системная информация обновлена');
    },

    // Автообновление
    startAutoRefresh() {
        // Обновляем системную статистику каждые 30 секунд
        setInterval(async () => {
            if (document.visibilityState === 'visible') {
                await this.loadSystemStats();
            }
        }, 30000);
    },

    // Отображение ошибки
    displayError(message) {
        const container = document.getElementById('users-table');
        if (container) {
            container.innerHTML = `
                <div style="text-align: center; padding: 40px; color: #dc3545;">
                    <h3>❌ ${message}</h3>
                    <button onclick="admin.loadUsers()" class="primary-btn" style="margin-top: 15px;">
                        🔄 Попробовать снова
                    </button>
                </div>
            `;
        }
    }
};