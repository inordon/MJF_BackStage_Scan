// responsive-tables.js - Динамическое преобразование таблиц в карточки на мобильных

class ResponsiveTables {
    constructor() {
        this.breakpoint = 768;
        this.isMobile = window.innerWidth <= this.breakpoint;
        this.init();
    }

    init() {
        this.handleResize();
        window.addEventListener('resize', this.debounce(() => {
            this.handleResize();
        }, 250));

        // Инициализируем при загрузке DOM
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                this.convertTables();
            });
        } else {
            this.convertTables();
        }

        // Отслеживаем динамически добавляемые таблицы
        this.observeTableChanges();
    }

    handleResize() {
        const wasMobile = this.isMobile;
        this.isMobile = window.innerWidth <= this.breakpoint;

        if (wasMobile !== this.isMobile) {
            this.convertTables();
        }
    }

    convertTables() {
        const tables = document.querySelectorAll('table');

        tables.forEach(table => {
            if (this.isMobile) {
                this.tableToCards(table);
            } else {
                this.cardsToTable(table);
            }
        });
    }

    tableToCards(table) {
        // Проверяем, не была ли таблица уже конвертирована
        if (table.classList.contains('converted-to-cards')) {
            return;
        }

        const container = table.closest('.table-container');
        if (!container) return;

        // Получаем заголовки
        const headers = Array.from(table.querySelectorAll('thead th')).map(th => th.textContent.trim());
        const rows = Array.from(table.querySelectorAll('tbody tr'));

        if (headers.length === 0 || rows.length === 0) return;

        // Создаем контейнер для карточек
        const cardsContainer = document.createElement('div');
        cardsContainer.className = 'mobile-cards';
        cardsContainer.setAttribute('data-original-table', 'true');

        rows.forEach((row, index) => {
            const cells = Array.from(row.querySelectorAll('td'));

            if (cells.length === 0) return;

            const card = document.createElement('div');
            card.className = 'mobile-card';
            card.setAttribute('data-row-index', index);

            // Определяем заголовок карточки (обычно первая или вторая колонка)
            const headerCell = cells[0] || cells[1];
            const headerText = this.extractTextContent(headerCell);

            if (headerText) {
                const cardHeader = document.createElement('div');
                cardHeader.className = 'mobile-card-header';
                cardHeader.innerHTML = headerText;
                card.appendChild(cardHeader);
            }

            // Создаем поля для остальных данных
            cells.forEach((cell, cellIndex) => {
                if (cellIndex === 0 && headerText) return; // Пропускаем заголовок

                const fieldDiv = document.createElement('div');
                fieldDiv.className = 'mobile-card-field';

                const labelDiv = document.createElement('div');
                labelDiv.className = 'mobile-card-label';
                labelDiv.textContent = headers[cellIndex] || `Поле ${cellIndex + 1}`;

                const valueDiv = document.createElement('div');
                valueDiv.className = 'mobile-card-value';
                valueDiv.innerHTML = cell.innerHTML;

                fieldDiv.appendChild(labelDiv);
                fieldDiv.appendChild(valueDiv);
                card.appendChild(fieldDiv);
            });

            // Обрабатываем кнопки действий
            const actionsCell = cells.find(cell =>
                cell.querySelector('button') ||
                cell.querySelector('.secondary-btn') ||
                cell.querySelector('.primary-btn')
            );

            if (actionsCell) {
                const actionsDiv = document.createElement('div');
                actionsDiv.className = 'mobile-card-actions';

                // Копируем все кнопки
                const buttons = actionsCell.querySelectorAll('button, .secondary-btn, .primary-btn');
                buttons.forEach(button => {
                    const clonedButton = button.cloneNode(true);
                    clonedButton.style.margin = '2px';
                    clonedButton.style.minWidth = '60px';
                    clonedButton.style.fontSize = '12px';
                    actionsDiv.appendChild(clonedButton);
                });

                if (buttons.length > 0) {
                    card.appendChild(actionsDiv);
                }
            }

            cardsContainer.appendChild(card);
        });

        // Скрываем таблицу и показываем карточки
        table.style.display = 'none';
        table.classList.add('converted-to-cards');

        // Вставляем карточки после таблицы
        table.parentNode.insertBefore(cardsContainer, table.nextSibling);
    }

    cardsToTable(table) {
        if (!table.classList.contains('converted-to-cards')) {
            return;
        }

        // Находим и удаляем контейнер с карточками
        const container = table.closest('.table-container');
        if (container) {
            const cardsContainer = container.querySelector('.mobile-cards[data-original-table="true"]');
            if (cardsContainer) {
                cardsContainer.remove();
            }
        }

        // Показываем таблицу
        table.style.display = '';
        table.classList.remove('converted-to-cards');
    }

    extractTextContent(element) {
        // Извлекаем текст, игнорируя кнопки и служебные элементы
        const clone = element.cloneNode(true);

        // Удаляем кнопки и служебные элементы
        const buttonsAndActions = clone.querySelectorAll('button, .secondary-btn, .primary-btn, script');
        buttonsAndActions.forEach(el => el.remove());

        return clone.textContent.trim();
    }

    observeTableChanges() {
        // Наблюдаем за изменениями в DOM для динамически добавляемых таблиц
        if (typeof MutationObserver !== 'undefined') {
            const observer = new MutationObserver((mutations) => {
                let shouldUpdate = false;

                mutations.forEach((mutation) => {
                    if (mutation.type === 'childList') {
                        mutation.addedNodes.forEach((node) => {
                            if (node.nodeType === 1) { // Element node
                                if (node.tagName === 'TABLE' || node.querySelector('table')) {
                                    shouldUpdate = true;
                                }
                            }
                        });
                    }
                });

                if (shouldUpdate) {
                    setTimeout(() => this.convertTables(), 100);
                }
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true
            });
        }
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

// Специальные методы для разных типов таблиц
class SpecializedTables {
    static formatVisitorsTable(card, rowData) {
        // Специальное форматирование для таблицы посетителей
        const nameElement = card.querySelector('.mobile-card-header');
        if (nameElement && rowData.name) {
            nameElement.innerHTML = `
                <strong>${rowData.name}</strong>
                ${rowData.event ? `<br><small style="color: #666;">${rowData.event}</small>` : ''}
            `;
        }

        // Добавляем статус как цветной индикатор
        if (rowData.status) {
            const statusElement = document.createElement('div');
            statusElement.className = `status-${rowData.status} mobile-status-badge`;
            statusElement.textContent = rowData.status === 'active' ? 'Активен' : 'Заблокирован';
            statusElement.style.cssText = `
                display: inline-block;
                padding: 4px 8px;
                border-radius: 10px;
                font-size: 11px;
                font-weight: 600;
                margin-top: 8px;
            `;
            nameElement.appendChild(statusElement);
        }
    }

    static formatUsersTable(card, rowData) {
        // Специальное форматирование для таблицы пользователей
        const nameElement = card.querySelector('.mobile-card-header');
        if (nameElement && rowData.fullName) {
            nameElement.innerHTML = `
                <strong>${rowData.fullName}</strong>
                <br><small style="color: #666;">@${rowData.username}</small>
            `;
        }
    }

    static formatEventsTable(card, rowData) {
        // Специальное форматирование для таблицы событий
        const nameElement = card.querySelector('.mobile-card-header');
        if (nameElement && rowData.eventName) {
            nameElement.innerHTML = `
                <strong>${rowData.eventName}</strong>
                ${rowData.dates ? `<br><small style="color: #666;">${rowData.dates}</small>` : ''}
            `;
        }
    }
}

// Утилиты для адаптивности
class ResponsiveUtils {
    static isMobile() {
        return window.innerWidth <= 768;
    }

    static isTablet() {
        return window.innerWidth > 768 && window.innerWidth <= 1024;
    }

    static isDesktop() {
        return window.innerWidth > 1024;
    }

    static addMobileClass() {
        if (this.isMobile()) {
            document.body.classList.add('mobile-view');
            document.body.classList.remove('tablet-view', 'desktop-view');
        } else if (this.isTablet()) {
            document.body.classList.add('tablet-view');
            document.body.classList.remove('mobile-view', 'desktop-view');
        } else {
            document.body.classList.add('desktop-view');
            document.body.classList.remove('mobile-view', 'tablet-view');
        }
    }

    static optimizeForTouch() {
        if ('ontouchstart' in window) {
            document.body.classList.add('touch-device');

            // Увеличиваем размер кликабельных элементов
            const style = document.createElement('style');
            style.textContent = `
                .touch-device button,
                .touch-device .nav-link,
                .touch-device .secondary-btn,
                .touch-device .primary-btn {
                    min-height: 44px;
                    padding: 12px 16px;
                }
            `;
            document.head.appendChild(style);
        }
    }

    static handleOrientationChange() {
        window.addEventListener('orientationchange', () => {
            setTimeout(() => {
                ResponsiveUtils.addMobileClass();
                // Принудительно обновляем высоту viewport
                const vh = window.innerHeight * 0.01;
                document.documentElement.style.setProperty('--vh', `${vh}px`);
            }, 100);
        });
    }
}

// Автоинициализация при загрузке
document.addEventListener('DOMContentLoaded', () => {
    // Инициализируем адаптивные таблицы
    new ResponsiveTables();

    // Добавляем классы для определения типа устройства
    ResponsiveUtils.addMobileClass();
    ResponsiveUtils.optimizeForTouch();
    ResponsiveUtils.handleOrientationChange();

    // Обновляем при изменении размера окна
    window.addEventListener('resize', ResponsiveUtils.debounce(() => {
        ResponsiveUtils.addMobileClass();
    }, 250));
});

// Экспортируем для использования в других модулях
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ResponsiveTables, SpecializedTables, ResponsiveUtils };
}