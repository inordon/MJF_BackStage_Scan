// js/auth.js - Модуль авторизации
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

    // Проверка прав доступа
    hasRole(requiredRoles) {
        if (!this.currentUser) return false;
        if (Array.isArray(requiredRoles)) {
            return requiredRoles.includes(this.currentUser.role);
        }
        return this.currentUser.role === requiredRoles;
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
        utils.showAlert('error', 'Ошибка авторизации: ' + error.message);
    }
};