// js/app.js - Основной файл приложения
class App {
    constructor() {
        this.state = {
            currentUser: null,
            currentPage: this.getCurrentPage()
        };
    }

    getCurrentPage() {
        const path = window.location.pathname;
        if (path.includes('visitors.html')) return 'visitors';
        if (path.includes('events.html')) return 'events';
        if (path.includes('scanner.html')) return 'scanner';
        if (path.includes('stats.html')) return 'stats';
        return 'index';
    }

    async init() {
        console.log('🚀 Инициализация приложения...');

        // Проверяем авторизацию
        if (!await auth.check()) {
            return;
        }

        // Инициализируем страницу в зависимости от типа
        switch (this.state.currentPage) {
            case 'visitors':
                if (typeof visitors !== 'undefined') {
                    await visitors.initAddForm();
                }
                break;
            case 'events':
                if (typeof events !== 'undefined') {
                    await events.init();
                }
                break;
            case 'scanner':
                if (typeof scanner !== 'undefined') {
                    await scanner.init();
                }
                break;
            case 'stats':
                if (typeof stats !== 'undefined') {
                    await stats.init();
                }
                break;
            default:
                // Главная страница - список посетителей
                if (typeof visitors !== 'undefined') {
                    await visitors.loadEvents();
                    await visitors.loadList();
                }
        }

        console.log('✅ Инициализация завершена');
    }

    // Утилиты для всех страниц
    showAlert(type, message) {
        const alert = document.createElement('div');
        alert.className = `alert alert-${type}`;
        alert.textContent = message;
        document.body.appendChild(alert);
        setTimeout(() => alert.remove(), 3000);
    }

    showModal(html, onSubmit) {
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `<div class="modal-content">${html}</div>`;
        document.body.appendChild(modal);

        modal.onclick = (e) => {
            if (e.target === modal) modal.remove();
        };

        if (onSubmit) {
            const form = modal.querySelector('form');
            if (form) {
                form.onsubmit = async (e) => {
                    e.preventDefault();
                    await onSubmit(new FormData(e.target));
                    modal.remove();
                };
            }
        }
    }

    formatDate(dateString) {
        if (!dateString) return '';
        return new Date(dateString).toLocaleDateString('ru-RU');
    }

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
    }
}

// Глобальный экземпляр
const app = new App();

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', () => app.init());