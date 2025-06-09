// js/utils.js - Общие утилиты
const utils = {
    // API запросы
    async apiRequest(url, options = {}) {
        try {
            const response = await fetch(url, {
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers
                },
                ...options
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `HTTP ${response.status}`);
            }

            return await response.json();
        } catch (err) {
            console.error(`API Error [${url}]:`, err);
            throw err;
        }
    },

    // Форматирование
    formatDateTime(dateString) {
        if (!dateString) return 'Нет данных';
        return new Date(dateString).toLocaleString('ru-RU');
    },

    formatTime(dateString) {
        if (!dateString) return 'Нет данных';
        return new Date(dateString).toLocaleTimeString('ru-RU', {
            hour: '2-digit',
            minute: '2-digit'
        });
    },

    formatDate(dateString) {
        if (!dateString) return '';
        return new Date(dateString).toLocaleDateString('ru-RU');
    },

    // Статусы
    getStatusText(status) {
        const statusMap = {
            'active': 'Активен',
            'blocked': 'Заблокирован',
            'inactive': 'Неактивен',
            'completed': 'Завершен',
            'cancelled': 'Отменен'
        };
        return statusMap[status] || status;
    },

    getRoleText(role) {
        const roleMap = {
            'admin': 'Администратор',
            'moderator': 'Модератор',
            'skd': 'СКД'
        };
        return roleMap[role] || role;
    },

    // Уведомления
    showAlert(type, message) {
        const alert = document.createElement('div');
        alert.className = `alert alert-${type}`;
        alert.innerHTML = `
            <span>${message}</span>
            <button onclick="this.parentElement.remove()" style="background: none; border: none; color: inherit; font-size: 18px; cursor: pointer;">×</button>
        `;
        document.body.appendChild(alert);

        // Автоматическое удаление через 5 секунд
        setTimeout(() => {
            if (alert.parentElement) {
                alert.remove();
            }
        }, 5000);
    },

    // Валидация
    validateBarcode(barcode) {
        if (!barcode) return false;
        return /^[A-Z0-9-_]+$/.test(barcode) && barcode.length >= 3 && barcode.length <= 100;
    },

    validateEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    },

    // Пагинация
    renderPagination(containerId, pagination, loadFunction) {
        const container = document.getElementById(containerId);
        if (!container) return;

        if (pagination.pages <= 1) {
            container.classList.add('hidden');
            return;
        }

        container.innerHTML = `
            <button onclick="${loadFunction}(${pagination.page - 1})" 
                    ${pagination.page === 1 ? 'disabled' : ''}>←</button>
            <span>Страница ${pagination.page} из ${pagination.pages}</span>
            <button onclick="${loadFunction}(${pagination.page + 1})" 
                    ${pagination.page === pagination.pages ? 'disabled' : ''}>→</button>
        `;
        container.classList.remove('hidden');
    },

    // Генерация штрихкода
    generateBarcode() {
        const date = new Date();
        const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
        const randomNum = Math.floor(Math.random() * 9000) + 1000;
        return `VIS${dateStr}${randomNum}`;
    },

    // Загрузка файлов
    downloadFile(blob, filename) {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    },

    // Debounce
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    },

    // Проверка прав доступа
    hasRole(userRole, allowedRoles) {
        return allowedRoles.includes(userRole);
    },

    // Обработка ошибок
    handleError(error, context = '') {
        console.error(`Error ${context}:`, error);

        let message = 'Произошла ошибка';
        if (error.message) {
            if (error.message.includes('NetworkError') || error.message.includes('fetch')) {
                message = 'Ошибка сети. Проверьте подключение к интернету.';
            } else if (error.message.includes('401')) {
                message = 'Требуется авторизация';
                window.location.href = '/login';
                return;
            } else if (error.message.includes('403')) {
                message = 'Недостаточно прав доступа';
            } else {
                message = error.message;
            }
        }

        this.showAlert('error', message);
    }
};

// Глобальные сокращения для удобства
window.showAlert = utils.showAlert.bind(utils);
window.formatDate = utils.formatDate.bind(utils);
window.apiRequest = utils.apiRequest.bind(utils);