// debug.js - Модуль отладки и тестирования API
// Загружается только в режиме разработки или при включенной отладке

(function(window) {
    'use strict';

    const Debug = {
        // Конфигурация
        config: {
            enabled: false,
            logLevel: 'info', // 'debug', 'info', 'warn', 'error'
            showInConsole: true,
            showInUI: false
        },

        // Инициализация модуля отладки
        init(app, config = {}) {
            this.app = app;
            this.config = { ...this.config, ...config };

            if (!this.config.enabled) {
                return;
            }

            this.log('info', '🛠️ Модуль отладки загружен');
            this.createDebugPanel();
            this.setupKeyboardShortcuts();
            this.addTestMethods();
        },

        // Логирование с уровнями
        log(level, message, data = null) {
            if (!this.config.showInConsole) return;

            const levels = ['debug', 'info', 'warn', 'error'];
            const currentLevelIndex = levels.indexOf(this.config.logLevel);
            const messageLevelIndex = levels.indexOf(level);

            if (messageLevelIndex >= currentLevelIndex) {
                const prefix = {
                    debug: '🔍',
                    info: 'ℹ️',
                    warn: '⚠️',
                    error: '❌'
                }[level];

                console[level === 'debug' ? 'log' : level](`${prefix} [DEBUG]`, message, data || '');
            }
        },

        // Создание панели отладки в UI
        createDebugPanel() {
            if (!this.config.showInUI) return;

            const panel = document.createElement('div');
            panel.id = 'debug-panel';
            panel.style.cssText = `
                position: fixed;
                top: 10px;
                right: 10px;
                width: 300px;
                max-height: 400px;
                background: #2d3748;
                color: #e2e8f0;
                border-radius: 8px;
                padding: 15px;
                font-family: 'Courier New', monospace;
                font-size: 12px;
                z-index: 10000;
                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                overflow-y: auto;
                display: none;
            `;

            panel.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                    <strong>🛠️ Отладка</strong>
                    <button onclick="window.Debug.hidePanel()" style="background: #e53e3e; color: white; border: none; border-radius: 4px; padding: 2px 6px; cursor: pointer;">✕</button>
                </div>
                <div id="debug-content"></div>
                <div style="margin-top: 10px; display: flex; gap: 5px; flex-wrap: wrap;">
                    <button onclick="window.Debug.API.testEventsAPI()" style="background: #3182ce; color: white; border: none; border-radius: 4px; padding: 4px 8px; cursor: pointer; font-size: 10px;">Test Events</button>
                    <button onclick="window.Debug.API.diagnose()" style="background: #38a169; color: white; border: none; border-radius: 4px; padding: 4px 8px; cursor: pointer; font-size: 10px;">Diagnose</button>
                    <button onclick="window.Debug.showState()" style="background: #d69e2e; color: white; border: none; border-radius: 4px; padding: 4px 8px; cursor: pointer; font-size: 10px;">State</button>
                </div>
            `;

            document.body.appendChild(panel);
            this.panel = panel;
        },

        // Настройка горячих клавиш
        setupKeyboardShortcuts() {
            document.addEventListener('keydown', (e) => {
                // Ctrl+Shift+D - показать/скрыть панель отладки
                if (e.ctrlKey && e.shiftKey && e.key === 'D') {
                    e.preventDefault();
                    this.togglePanel();
                }

                // Ctrl+Shift+T - тест API событий
                if (e.ctrlKey && e.shiftKey && e.key === 'T') {
                    e.preventDefault();
                    this.API.testEventsAPI();
                }

                // Ctrl+Shift+S - показать состояние
                if (e.ctrlKey && e.shiftKey && e.key === 'S') {
                    e.preventDefault();
                    this.showState();
                }
            });
        },

        // Добавление методов в основное приложение
        addTestMethods() {
            if (!this.app || !this.app.visitors) return;

            // Добавляем testEventsAPI в visitors если его нет
            if (!this.app.visitors.testEventsAPI) {
                this.app.visitors.testEventsAPI = () => this.API.testEventsAPI();
            }

            this.log('info', '✅ Методы тестирования добавлены в приложение');
        },

        // Управление панелью
        showPanel() {
            if (this.panel) {
                this.panel.style.display = 'block';
            }
        },

        hidePanel() {
            if (this.panel) {
                this.panel.style.display = 'none';
            }
        },

        togglePanel() {
            if (!this.panel) {
                this.createDebugPanel();
            }

            if (this.panel.style.display === 'none') {
                this.showPanel();
            } else {
                this.hidePanel();
            }
        },

        // Добавление сообщения в панель
        addToPanel(message) {
            if (!this.panel) return;

            const content = this.panel.querySelector('#debug-content');
            if (content) {
                const line = document.createElement('div');
                line.style.marginBottom = '5px';
                line.innerHTML = `<span style="color: #a0aec0">${new Date().toLocaleTimeString()}</span> ${message}`;
                content.appendChild(line);

                // Ограничиваем количество сообщений
                if (content.children.length > 50) {
                    content.removeChild(content.firstChild);
                }

                content.scrollTop = content.scrollHeight;
            }
        },

        // Показать состояние приложения
        showState() {
            if (!this.app) {
                this.log('error', 'Приложение не найдено');
                return;
            }

            const state = {
                currentUser: this.app.state?.currentUser,
                visitorsCount: this.app.state?.visitors?.length || 0,
                eventsCount: this.app.state?.events?.length || 0,
                usersCount: this.app.state?.users?.length || 0,
                pagination: this.app.state?.pagination
            };

            this.log('info', '📊 Состояние приложения:', state);

            if (this.config.showInUI) {
                this.addToPanel(`📊 <strong>Состояние:</strong> ${JSON.stringify(state, null, 2)}`);
            }
        },

        // API тестирование
        API: {
            // Тестирование API событий (перенесено из index.html)
            async testEventsAPI() {
                Debug.log('info', '🧪 Запуск тестирования API событий...');

                if (Debug.config.showInUI) {
                    Debug.addToPanel('🧪 <strong>Тестирование API событий...</strong>');
                }

                // Тест 1: Основной endpoint событий
                Debug.log('info', '📡 Тест 1: /api/events');
                try {
                    const response = await fetch('/api/events');
                    Debug.log('info', `📊 Статус ответа /api/events: ${response.status} ${response.statusText}`);

                    const data = await response.json();
                    Debug.log('info', '📊 Ответ /api/events:', data);

                    if (data.events) {
                        Debug.log('info', `📊 Всего событий: ${data.events.length}`);
                        const activeEvents = data.events.filter(e => e.status === 'active');
                        Debug.log('info', `📊 Активных событий: ${activeEvents.length}`);

                        activeEvents.forEach((event, i) => {
                            Debug.log('debug', `  ${i + 1}. ${event.name} (ID: ${event.id}, до: ${event.end_date})`);
                        });

                        if (Debug.config.showInUI) {
                            Debug.addToPanel(`✅ /api/events: ${data.events.length} событий`);
                        }
                    } else {
                        Debug.log('warn', '⚠️ Нет поля events в ответе /api/events');
                        if (Debug.config.showInUI) {
                            Debug.addToPanel('⚠️ /api/events: нет поля events');
                        }
                    }
                } catch (err) {
                    Debug.log('error', '❌ Ошибка /api/events:', err);
                    if (Debug.config.showInUI) {
                        Debug.addToPanel(`❌ /api/events: ${err.message}`);
                    }
                }

                // Тест 2: Альтернативный endpoint
                Debug.log('info', '📡 Тест 2: /api/visitors/events/active');
                try {
                    const response = await fetch('/api/visitors/events/active');
                    Debug.log('info', `📊 Статус ответа /api/visitors/events/active: ${response.status} ${response.statusText}`);

                    const text = await response.text();
                    Debug.log('debug', '📊 Сырой ответ /api/visitors/events/active:', text);

                    const data = JSON.parse(text);
                    Debug.log('info', '📊 Парсинг JSON успешен:', data);

                    if (Debug.config.showInUI) {
                        Debug.addToPanel(`✅ /api/visitors/events/active: OK`);
                    }
                } catch (err) {
                    Debug.log('error', '❌ Ошибка /api/visitors/events/active:', err);
                    if (Debug.config.showInUI) {
                        Debug.addToPanel(`❌ /api/visitors/events/active: ${err.message}`);
                    }
                }

                // Тест 3: Состояние DOM
                Debug.log('info', '📡 Тест 3: Состояние DOM');
                const filter = document.getElementById('event-filter');
                if (filter) {
                    Debug.log('info', `📊 Фильтр найден, опций: ${filter.options.length}`);
                    for (let i = 0; i < Math.min(filter.options.length, 5); i++) {
                        Debug.log('debug', `  ${i}: "${filter.options[i].text}" (value: "${filter.options[i].value}")`);
                    }

                    if (Debug.config.showInUI) {
                        Debug.addToPanel(`📋 Фильтр: ${filter.options.length} опций`);
                    }
                } else {
                    Debug.log('error', '❌ Фильтр не найден в DOM');
                    if (Debug.config.showInUI) {
                        Debug.addToPanel('❌ Фильтр событий не найден');
                    }
                }

                // Тест 4: Форма
                const formSelect = document.querySelector('#visitor-form select[name="eventId"]');
                if (formSelect) {
                    Debug.log('info', `📊 Форма найдена, опций: ${formSelect.options.length}`);
                    for (let i = 0; i < Math.min(formSelect.options.length, 3); i++) {
                        Debug.log('debug', `  Форма ${i}: "${formSelect.options[i].text}" (value: "${formSelect.options[i].value}")`);
                    }

                    if (Debug.config.showInUI) {
                        Debug.addToPanel(`📝 Форма: ${formSelect.options.length} опций`);
                    }
                } else {
                    Debug.log('error', '❌ Форма не найдена в DOM');
                    if (Debug.config.showInUI) {
                        Debug.addToPanel('❌ Форма добавления не найдена');
                    }
                }

                Debug.log('info', '✅ Тестирование API завершено');

                if (Debug.app && Debug.app.showAlert) {
                    Debug.app.showAlert('info', 'Тест API завершен, смотрите консоль для результатов');
                }
            },

            // Полная диагностика системы
            async diagnose() {
                Debug.log('info', '🔍 Запуск полной диагностики системы...');

                if (Debug.config.showInUI) {
                    Debug.addToPanel('🔍 <strong>Полная диагностика...</strong>');
                }

                // Проверяем API endpoints
                const apiTests = [
                    { name: 'События (основной)', url: '/api/events' },
                    { name: 'События (альтернативный)', url: '/api/visitors/events/active' },
                    { name: 'Авторизация', url: '/api/auth/check' },
                    { name: 'Статистика', url: '/api/visitors/stats/overview' }
                ];

                for (const test of apiTests) {
                    try {
                        const res = await fetch(test.url);
                        const data = await res.json();
                        Debug.log('info', `✅ ${test.name}: ${res.status}`, data);

                        if (Debug.config.showInUI) {
                            Debug.addToPanel(`✅ ${test.name}: ${res.status}`);
                        }
                    } catch (err) {
                        Debug.log('error', `❌ ${test.name}: ${err.message}`);

                        if (Debug.config.showInUI) {
                            Debug.addToPanel(`❌ ${test.name}: ошибка`);
                        }
                    }
                }

                // Проверяем DOM элементы
                const elements = [
                    'event-filter',
                    'visitor-form',
                    'events-list',
                    'visitors-table',
                    'stats-overview'
                ];

                elements.forEach(id => {
                    const el = document.getElementById(id);
                    const status = el ? '✅' : '❌';
                    const message = el ? 'найден' : 'отсутствует';
                    Debug.log('info', `${status} Элемент #${id}: ${message}`);

                    if (Debug.config.showInUI) {
                        Debug.addToPanel(`${status} #${id}: ${message}`);
                    }
                });

                // Проверяем состояние приложения
                if (Debug.app && Debug.app.state) {
                    const state = Debug.app.state;
                    Debug.log('info', '📊 Состояние приложения:');
                    Debug.log('info', `- Пользователь: ${state.currentUser?.username || 'не авторизован'}`);
                    Debug.log('info', `- События: ${state.events?.length || 0}`);
                    Debug.log('info', `- Посетители: ${state.visitors?.length || 0}`);

                    if (Debug.config.showInUI) {
                        Debug.addToPanel(`📊 Данные: ${state.events?.length || 0} событий, ${state.visitors?.length || 0} посетителей`);
                    }
                }

                Debug.log('info', '✅ Диагностика завершена');
            },

            // Принудительное обновление фильтра
            async forceUpdateFilter() {
                Debug.log('info', '🔄 Принудительное обновление фильтра...');

                const filter = document.getElementById('event-filter');
                if (!filter) {
                    Debug.log('error', '❌ Фильтр не найден');
                    return;
                }

                filter.innerHTML = '<option value="">🔄 Загрузка...</option>';

                try {
                    if (Debug.app && Debug.app.events && Debug.app.events.loadActiveForFilters) {
                        await Debug.app.events.loadActiveForFilters();
                        Debug.log('info', '✅ Фильтр обновлен');
                    } else {
                        Debug.log('error', '❌ Метод loadActiveForFilters не найден');
                    }
                } catch (err) {
                    Debug.log('error', '❌ Ошибка обновления:', err);
                    filter.innerHTML = '<option value="">❌ Ошибка</option>';
                }
            },

            // Создание тестовых событий
            async createTestEvents() {
                if (!Debug.app || !Debug.app.events || !Debug.app.events.createTestEventsIfNeeded) {
                    Debug.log('error', '❌ Метод создания тестовых событий не найден');
                    return;
                }

                try {
                    await Debug.app.events.createTestEventsIfNeeded();
                    Debug.log('info', '✅ Тестовые события созданы');
                } catch (err) {
                    Debug.log('error', '❌ Ошибка создания тестовых событий:', err);
                }
            }
        },

        // Утилиты для перформанса
        Performance: {
            startTimer(name) {
                performance.mark(`${name}-start`);
            },

            endTimer(name) {
                performance.mark(`${name}-end`);
                performance.measure(name, `${name}-start`, `${name}-end`);
                const measure = performance.getEntriesByName(name)[0];
                Debug.log('info', `⏱️ ${name}: ${measure.duration.toFixed(2)}ms`);
                return measure.duration;
            },

            measureFunction(fn, name) {
                return function(...args) {
                    Debug.Performance.startTimer(name);
                    const result = fn.apply(this, args);
                    Debug.Performance.endTimer(name);
                    return result;
                };
            }
        }
    };

    // Экспортируем в глобальную область
    window.Debug = Debug;

    // Автоматическая инициализация если есть конфигурация
    if (window.DEBUG_CONFIG) {
        window.addEventListener('DOMContentLoaded', () => {
            Debug.init(window.app, window.DEBUG_CONFIG);
        });
    }

    Debug.log('info', '🛠️ Модуль отладки готов к инициализации');

})(window);