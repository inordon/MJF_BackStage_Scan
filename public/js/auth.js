// js/auth.js - Модуль авторизации с поддержкой админ панели
const auth = {
    currentUser: null,

    // Проверка текущей авторизации
    async check() {
        try {
            const response = await fetch('/api/auth/check');
            const data = await response.json();

            if (data.authenticated) {
                this.currentUser = data.user;
                this.updateUserDisplay();
                this.updateAdminNavigation(); // Обновляем навигацию администратора
                return true;
            } else {
                this.redirectToLogin();
                return false;
            }
        } catch (err) {
            console.error('Ошибка проверки авторизации:', err);
            this.redirectToLogin();
            return false;
        }
    },

    // Выход из системы
    async logout() {
        try {
            await fetch('/api/auth/logout', { method: 'POST' });
            window.location.href = '/login';
        } catch (err) {
            console.error('Ошибка выхода:', err);
            // Принудительный редирект даже при ошибке
            window.location.href = '/login';
        }
    },

    // Обновление отображения пользователя
    updateUserDisplay() {
        const userBadge = document.getElementById('user-badge');
        if (userBadge && this.currentUser) {
            const roleText = {
                'admin': '👑 Администратор',
                'moderator': '⚙️ Модератор',
                'skd': '🔒 СКД'
            }[this.currentUser.role] || this.currentUser.role;

            userBadge.textContent = `${roleText} | ${this.currentUser.fullName}`;
        }
    },

    // Обновление навигации администратора
    updateAdminNavigation() {
        const adminNav = document.getElementById('admin-nav');
        if (adminNav && this.currentUser) {
            if (this.currentUser.role === 'admin') {
                adminNav.style.display = 'block';
                console.log('✅ Админ ссылка показана для пользователя:', this.currentUser.username);
            } else {
                adminNav.style.display = 'none';
                console.log('ℹ️ Админ ссылка скрыта для роли:', this.currentUser.role);
            }
        }

        // Также обновляем другие элементы интерфейса в зависимости от роли
        this.updateRoleBasedElements();
    },

    // Обновление элементов интерфейса в зависимости от роли
    updateRoleBasedElements() {
        if (!this.currentUser) return;

        const role = this.currentUser.role;

        // Скрываем кнопки создания событий для роли СКД
        const createEventBtns = document.querySelectorAll('#create-event-btn, .create-event-btn');
        createEventBtns.forEach(btn => {
            if (role === 'skd') {
                btn.style.display = 'none';
            } else {
                btn.style.display = btn.classList.contains('primary-btn') ? 'inline-flex' : 'inline-block';
            }
        });

        // Скрываем кнопки создания пользователей для не-администраторов
        const createUserBtns = document.querySelectorAll('#create-user-btn, .create-user-btn');
        createUserBtns.forEach(btn => {
            if (role !== 'admin') {
                btn.style.display = 'none';
            } else {
                btn.style.display = btn.classList.contains('primary-btn') ? 'inline-flex' : 'inline-block';
            }
        });

        // Скрываем экспорт данных для СКД
        const exportBtns = document.querySelectorAll('#export-btn, .export-btn');
        exportBtns.forEach(btn => {
            if (role === 'skd') {
                btn.style.display = 'none';
            } else {
                btn.style.display = btn.classList.contains('primary-btn') ? 'inline-flex' : 'inline-block';
            }
        });

        // Обновляем body класс для CSS селекторов
        document.body.className = document.body.className.replace(/\b(admin|moderator|skd)-role\b/g, '');
        document.body.classList.add(`${role}-role`);

        console.log(`🎨 Интерфейс обновлен для роли: ${role}`);
    },

    // Проверка прав доступа
    hasRole(requiredRoles) {
        if (!this.currentUser) return false;
        if (Array.isArray(requiredRoles)) {
            return requiredRoles.includes(this.currentUser.role);
        }
        return this.currentUser.role === requiredRoles;
    },

    // Проверка прав администратора
    isAdmin() {
        return this.hasRole(['admin']);
    },

    // Проверка прав модератора или выше
    canModerate() {
        return this.hasRole(['admin', 'moderator']);
    },

    // Проверка прав на сканирование
    canScan() {
        return this.hasRole(['admin', 'moderator', 'skd']);
    },

    // Редирект на страницу входа
    redirectToLogin() {
        const currentPath = window.location.pathname;
        if (currentPath !== '/login') {
            window.location.href = `/login?return=${encodeURIComponent(currentPath)}`;
        }
    },

    // Обработка ошибок авторизации
    handleAuthError(error) {
        if (error.message && error.message.includes('401')) {
            this.redirectToLogin();
            return;
        }
        if (typeof utils !== 'undefined' && utils.showAlert) {
            utils.showAlert('error', 'Ошибка авторизации: ' + error.message);
        }
    },

    // Проверка доступа к администрированию
    checkAdminAccess() {
        if (!this.isAdmin()) {
            if (typeof utils !== 'undefined' && utils.showAlert) {
                utils.showAlert('error', 'Недостаточно прав доступа');
            }
            window.location.href = '/';
            return false;
        }
        return true;
    },

    // Проверка доступа к модерации
    checkModeratorAccess() {
        if (!this.canModerate()) {
            if (typeof utils !== 'undefined' && utils.showAlert) {
                utils.showAlert('error', 'Недостаточно прав доступа');
            }
            window.location.href = '/';
            return false;
        }
        return true;
    },

    // Получение текста роли для отображения
    getRoleDisplayText(role = null) {
        const targetRole = role || this.currentUser?.role;
        const roleTexts = {
            'admin': '👑 Администратор',
            'moderator': '⚙️ Модератор',
            'skd': '🔒 СКД'
        };
        return roleTexts[targetRole] || targetRole;
    },

    // Получение цвета роли
    getRoleColor(role = null) {
        const targetRole = role || this.currentUser?.role;
        const roleColors = {
            'admin': '#d4edda',
            'moderator': '#fff3cd',
            'skd': '#d1ecf1'
        };
        return roleColors[targetRole] || '#f8f9fa';
    },

    // Инициализация после загрузки DOM
    init() {
        // Добавляем обработчики для динамически создаваемых элементов
        document.addEventListener('click', (e) => {
            // Обработка кликов по админ элементам
            if (e.target.classList.contains('admin-only') && !this.isAdmin()) {
                e.preventDefault();
                e.stopPropagation();
                if (typeof utils !== 'undefined' && utils.showAlert) {
                    utils.showAlert('error', 'Недостаточно прав доступа');
                }
            }
        });

        console.log('🔐 Модуль авторизации инициализирован');
    },

    // Обновление активных элементов навигации
    updateActiveNavigation() {
        const currentPath = window.location.pathname;
        const navLinks = document.querySelectorAll('.nav-link');

        navLinks.forEach(link => {
            link.classList.remove('active');

            const href = link.getAttribute('href');
            if (href === currentPath ||
                (currentPath === '/' && href === '/') ||
                (currentPath.includes(href) && href !== '/')) {
                link.classList.add('active');
            }
        });
    },

    // Установка темы интерфейса на основе роли
    setRoleTheme() {
        if (!this.currentUser) return;

        const root = document.documentElement;
        const role = this.currentUser.role;

        // Устанавливаем CSS переменные для темы роли
        switch (role) {
            case 'admin':
                root.style.setProperty('--role-primary', '#dc3545');
                root.style.setProperty('--role-secondary', '#f8d7da');
                break;
            case 'moderator':
                root.style.setProperty('--role-primary', '#ffc107');
                root.style.setProperty('--role-secondary', '#fff3cd');
                break;
            case 'skd':
                root.style.setProperty('--role-primary', '#17a2b8');
                root.style.setProperty('--role-secondary', '#d1ecf1');
                break;
            default:
                root.style.setProperty('--role-primary', '#667eea');
                root.style.setProperty('--role-secondary', '#f8f9fa');
        }
    },

    // Логирование действий пользователя (клиентская сторона)
    logUserAction(action, details = {}) {
        if (this.currentUser && typeof console !== 'undefined') {
            console.log(`👤 ${this.currentUser.username} (${this.currentUser.role}): ${action}`, details);
        }
    },

    // Проверка на истечение сессии
    checkSessionExpiry() {
        setInterval(async () => {
            try {
                const response = await fetch('/api/auth/check');
                if (!response.ok) {
                    console.log('🔒 Сессия истекла, перенаправление на страницу входа');
                    this.redirectToLogin();
                }
            } catch (err) {
                console.error('Ошибка проверки сессии:', err);
            }
        }, 5 * 60 * 1000); // Проверяем каждые 5 минут
    },

    // Показать информацию о текущем пользователе
    showUserInfo() {
        if (!this.currentUser) return;

        const info = {
            'Пользователь': this.currentUser.fullName,
            'Логин': this.currentUser.username,
            'Роль': this.getRoleDisplayText(),
            'ID': this.currentUser.id
        };

        console.table(info);

        if (typeof utils !== 'undefined' && utils.showAlert) {
            const infoText = Object.entries(info)
                .map(([key, value]) => `${key}: ${value}`)
                .join('\n');

            utils.showAlert('info', `Информация о пользователе:\n${infoText}`);
        }
    }
};

// Инициализация при загрузке страницы
if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
        auth.init();
        auth.updateActiveNavigation();
    });

    // Обновляем навигацию при изменении URL (для SPA)
    window.addEventListener('popstate', () => {
        auth.updateActiveNavigation();
    });
}

// Экспорт для использования в других модулях
if (typeof module !== 'undefined' && module.exports) {
    module.exports = auth;
}