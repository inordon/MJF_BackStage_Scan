// js/visitors.js - Исправленный модуль управления посетителями
const visitors = {
    currentPage: 1,
    totalPages: 1,
    events: [],
    filters: {
        search: '',
        status: '',
        event_id: ''
    },

    // Инициализация для страницы добавления
    async initAddForm() {
        console.log('🔧 Инициализация формы добавления посетителя');
        await this.loadEvents();
        this.setupFormHandlers();
    },

    // ИСПРАВЛЕНИЕ: Загрузка событий для фильтров и формы
    async loadEvents() {
        try {
            console.log('🎯 Загрузка событий...');

            // ИСПРАВЛЕНИЕ: Используем правильный endpoint
            const response = await fetch('/api/visitors/events/active');

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            console.log('📡 Ответ сервера событий:', data);

            if (data.success && Array.isArray(data.events)) {
                this.events = data.events;
                this.updateEventSelectors();
                console.log(`✅ Загружено событий: ${this.events.length}`);
            } else {
                console.warn('⚠️ Неожиданная структура ответа или нет событий:', data);
                this.events = [];
                this.updateEventSelectors();
            }
        } catch (err) {
            console.error('❌ Ошибка загрузки событий:', err);
            this.events = [];
            this.updateEventSelectors();

            // Показываем пользователю информацию об ошибке
            if (typeof utils !== 'undefined' && utils.showAlert) {
                utils.showAlert('warning', 'Не удалось загрузить список событий');
            }
        }
    },

    // ИСПРАВЛЕНИЕ: Обновление селекторов событий
    updateEventSelectors() {
        console.log('🔄 Обновление селекторов событий, количество:', this.events.length);

        // Обновляем фильтр событий (на главной странице)
        const eventFilter = document.getElementById('event-filter');
        if (eventFilter) {
            eventFilter.innerHTML = '<option value="">Все события</option>';

            if (this.events.length === 0) {
                const option = document.createElement('option');
                option.value = '';
                option.textContent = '❌ Нет активных событий';
                option.disabled = true;
                eventFilter.appendChild(option);
            } else {
                this.events.forEach(event => {
                    const option = document.createElement('option');
                    option.value = event.id;

                    // Форматируем название с датами
                    let optionText = event.name;
                    if (event.start_date && event.end_date) {
                        optionText += ` (${this.formatDate(event.start_date)} - ${this.formatDate(event.end_date)})`;
                    }
                    if (event.location) {
                        optionText += ` • ${event.location}`;
                    }

                    option.textContent = optionText;
                    eventFilter.appendChild(option);
                });
            }
            console.log('✅ Фильтр событий обновлен');
        }

        // Обновляем селектор в форме добавления (на странице visitors.html)
        const eventSelect = document.getElementById('eventId');
        if (eventSelect) {
            if (this.events.length === 0) {
                eventSelect.innerHTML = '<option value="">❌ Нет активных событий</option>';
                eventSelect.disabled = true;
                console.log('⚠️ Форма: нет активных событий');
            } else {
                eventSelect.innerHTML = '<option value="">Выберите событие</option>';
                this.events.forEach(event => {
                    const option = document.createElement('option');
                    option.value = event.id;
                    option.textContent = event.name;
                    eventSelect.appendChild(option);
                });
                eventSelect.disabled = false;
                console.log('✅ Форма событий обновлена');
            }
        }
    },

    // ИСПРАВЛЕНИЕ: Загрузка списка посетителей с полной информацией
    async loadList(page = 1) {
        try {
            console.log('📋 Загрузка списка посетителей, страница:', page);

            const params = new URLSearchParams({
                page: page,
                limit: 25,
                ...this.filters
            });

            const response = await fetch(`/api/visitors?${params}`);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            console.log('📊 Получено посетителей:', data.visitors?.length || 0);

            this.displayVisitors(data.visitors);
            this.updatePagination(data.pagination);
            this.updateVisitorsCount(data.pagination.total);

        } catch (err) {
            console.error('❌ Ошибка загрузки посетителей:', err);
            this.displayError('Ошибка загрузки списка посетителей: ' + err.message);
        }
    },

    // ИСПРАВЛЕНИЕ: Отображение посетителей с полной информацией
    displayVisitors(visitors) {
        const container = document.getElementById('visitors-table');
        if (!container) {
            console.warn('⚠️ Контейнер visitors-table не найден');
            return;
        }

        if (!visitors || visitors.length === 0) {
            container.innerHTML = '<div class="empty">Посетители не найдены</div>';
            return;
        }

        console.log('🎨 Отображение посетителей:', visitors.length);

        const table = `
            <table>
                <thead>
                    <tr>
                        <th>ФИО</th>
                        <th>Событие</th>
                        <th>Штрихкод</th>
                        <th>Статус</th>
                        <th>Сканирования</th>
                        <th>Создан</th>
                        <th>Действия</th>
                    </tr>
                </thead>
                <tbody>
                    ${visitors.map(visitor => `
                        <tr data-visitor-id="${visitor.id}">
                            <td>
                                <strong>${visitor.last_name} ${visitor.first_name}</strong>
                                ${visitor.middle_name ? `<br><small>${visitor.middle_name}</small>` : ''}
                                ${visitor.comment ? `<br><em style="color: #666;">${visitor.comment}</em>` : ''}
                            </td>
                            <td>
                                ${visitor.event ?
            `<span style="font-weight: 600;">${visitor.event.name}</span>
                                     <br><small>${this.formatDate(visitor.event.start_date)} - ${this.formatDate(visitor.event.end_date)}</small>`
            : '<span style="color: #999;">Без события</span>'
        }
                            </td>
                            <td>
                                ${visitor.barcode ?
            `<code style="background: #f1f3f4; padding: 4px 8px; border-radius: 4px; font-size: 12px;">${visitor.barcode}</code>`
            : '<span style="color: #999;">Нет</span>'
        }
                                ${visitor.first_scan_today ? '<br><span class="badge" style="background: #e8f5e8; color: #2d5a2d; padding: 2px 6px; border-radius: 10px; font-size: 11px;">📱 Сканировался сегодня</span>' : ''}
                            </td>
                            <td>
                                <span class="status-${visitor.status}" style="padding: 4px 12px; border-radius: 15px; font-size: 12px; font-weight: 600; text-transform: uppercase;">
                                    ${this.getStatusText(visitor.status)}
                                </span>
                            </td>
                            <td>
                                <strong>${visitor.total_scans || 0}</strong> раз
                                ${visitor.last_scan ? `<br><small style="color: #666;">Последний: ${this.formatDateTime(visitor.last_scan)}</small>` : ''}
                            </td>
                            <td>
                                ${this.formatDate(visitor.created_at)}
                                ${visitor.created_by_name ? `<br><small style="color: #666;">${visitor.created_by_name}</small>` : ''}
                            </td>
                            <td>
                                <div style="display: flex; gap: 4px; flex-wrap: wrap;">
                                    <button onclick="visitors.viewQR(${visitor.id})" class="secondary-btn" title="Показать QR-код" style="padding: 6px 8px; font-size: 12px;">
                                        📱
                                    </button>
                                    ${auth.hasRole(['admin', 'moderator']) ? `
                                        <button onclick="visitors.editVisitor(${visitor.id})" class="secondary-btn" title="Редактировать" style="padding: 6px 8px; font-size: 12px;">
                                            ✏️
                                        </button>
                                        <button onclick="visitors.toggleStatus(${visitor.id}, '${visitor.status}')" 
                                                class="secondary-btn" 
                                                title="${visitor.status === 'active' ? 'Заблокировать' : 'Разблокировать'}"
                                                style="padding: 6px 8px; font-size: 12px;">
                                            ${visitor.status === 'active' ? '🚫' : '✅'}
                                        </button>
                                    ` : ''}
                                </div>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;

        container.innerHTML = table;
        console.log('✅ Таблица посетителей отображена');
    },

    // Обновление счетчика посетителей
    updateVisitorsCount(total) {
        const counter = document.getElementById('visitors-count');
        if (counter) {
            counter.textContent = `${total} посетителей`;
        }
    },

    // Обновление пагинации
    updatePagination(pagination) {
        this.currentPage = pagination.page;
        this.totalPages = pagination.pages;

        if (typeof utils !== 'undefined' && utils.renderPagination) {
            utils.renderPagination('visitors-pagination', pagination, 'visitors.loadList');
        }
    },

    // Настройка обработчиков формы
    setupFormHandlers() {
        const form = document.getElementById('visitor-form');
        if (form) {
            form.addEventListener('submit', this.handleFormSubmit.bind(this));
            console.log('✅ Обработчики формы настроены');
        }
    },

    // ИСПРАВЛЕНИЕ: Обработка отправки формы с правильными полями
    async handleFormSubmit(e) {
        e.preventDefault();
        console.log('📝 Отправка формы создания посетителя');

        const submitBtn = e.target.querySelector('button[type="submit"]');
        const btnText = submitBtn.querySelector('.btn-text');
        const btnLoading = submitBtn.querySelector('.btn-loading');

        try {
            // Показываем индикатор загрузки
            submitBtn.disabled = true;
            if (btnText) btnText.classList.add('hidden');
            if (btnLoading) btnLoading.classList.remove('hidden');

            const formData = new FormData(e.target);

            // Логируем данные формы для отладки
            console.log('📋 Данные формы:');
            for (let [key, value] of formData.entries()) {
                console.log(`  ${key}:`, value);
            }

            const response = await fetch('/api/visitors', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `HTTP ${response.status}`);
            }

            const data = await response.json();
            console.log('✅ Посетитель создан:', data);

            this.showCreationResult(data.visitor);
            this.resetForm();

            if (typeof utils !== 'undefined' && utils.showAlert) {
                utils.showAlert('success', 'Посетитель успешно создан!');
            }

        } catch (err) {
            console.error('❌ Ошибка создания посетителя:', err);
            if (typeof utils !== 'undefined' && utils.showAlert) {
                utils.showAlert('error', err.message);
            }
        } finally {
            // Возвращаем кнопку в исходное состояние
            submitBtn.disabled = false;
            if (btnText) btnText.classList.remove('hidden');
            if (btnLoading) btnLoading.classList.add('hidden');
        }
    },

    // ИСПРАВЛЕНИЕ: Показ результата создания с правильными данными
    showCreationResult(visitor) {
        const resultContainer = document.getElementById('creation-result');
        const visitorInfo = document.getElementById('visitor-info');

        if (resultContainer && visitorInfo) {
            console.log('🎉 Показ результата создания:', visitor);

            visitorInfo.innerHTML = `
                <p><strong>ФИО:</strong> ${visitor.last_name} ${visitor.first_name} ${visitor.middle_name || ''}</p>
                <p><strong>Событие:</strong> ${visitor.event_name || 'Не указано'}</p>
                <p><strong>Штрихкод:</strong> <code style="background: #f1f3f4; padding: 4px 8px; border-radius: 4px;">${visitor.barcode}</code></p>
                ${visitor.comment ? `<p><strong>Комментарий:</strong> ${visitor.comment}</p>` : ''}
            `;

            // Генерируем QR код
            if (visitor.barcode) {
                this.generateQRCode(visitor.barcode);
            }

            resultContainer.classList.remove('hidden');

            // Прокручиваем к результату
            resultContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    },

    // Генерация QR кода
    generateQRCode(barcode) {
        const canvas = document.getElementById('qr-canvas');
        if (canvas && window.qrcode) {
            try {
                console.log('🔄 Генерация QR кода для:', barcode);

                const qr = window.qrcode(4, 'M');
                qr.addData(barcode);
                qr.make();

                const cellSize = 4;
                const margin = 16;
                const size = qr.getModuleCount() * cellSize + margin * 2;

                canvas.width = size;
                canvas.height = size;

                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#FFFFFF';
                ctx.fillRect(0, 0, size, size);

                ctx.fillStyle = '#000000';
                for (let row = 0; row < qr.getModuleCount(); row++) {
                    for (let col = 0; col < qr.getModuleCount(); col++) {
                        if (qr.isDark(row, col)) {
                            ctx.fillRect(
                                col * cellSize + margin,
                                row * cellSize + margin,
                                cellSize,
                                cellSize
                            );
                        }
                    }
                }

                console.log('✅ QR код сгенерирован');
            } catch (err) {
                console.error('❌ Ошибка генерации QR кода:', err);
            }
        } else {
            console.warn('⚠️ QR библиотека или canvas не найдены');
        }
    },

    // Скачать QR код
    downloadQR() {
        const canvas = document.getElementById('qr-canvas');
        if (canvas) {
            const link = document.createElement('a');
            link.download = 'visitor-qr-code.png';
            link.href = canvas.toDataURL();
            link.click();
        }
    },

    // Печать QR кода
    printQR() {
        const canvas = document.getElementById('qr-canvas');
        if (canvas) {
            const dataUrl = canvas.toDataURL();
            const windowContent = `
                <!DOCTYPE html>
                <html>
                <head><title>QR Код посетителя</title></head>
                <body style="text-align: center; padding: 20px;">
                    <h2>QR Код посетителя</h2>
                    <img src="${dataUrl}" style="max-width: 100%;">
                    <script>window.print(); window.close();</script>
                </body>
                </html>
            `;
            const printWindow = window.open('', '', 'width=400,height=400');
            printWindow.document.open();
            printWindow.document.write(windowContent);
            printWindow.document.close();
        }
    },

    // ИСПРАВЛЕНИЕ: Просмотр QR кода с правильным URL
    async viewQR(visitorId) {
        try {
            console.log('📱 Показ QR кода для посетителя:', visitorId);

            const qrUrl = `/api/visitors/${visitorId}/qr`;
            const modal = document.createElement('div');
            modal.className = 'modal';
            modal.style.cssText = `
                position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(0,0,0,0.6); z-index: 1000;
                display: flex; align-items: center; justify-content: center;
                opacity: 0; animation: fadeIn 0.3s ease forwards;
            `;

            modal.innerHTML = `
                <div class="modal-content" style="background: #fff; padding: 0; border-radius: 16px; max-width: 400px; width: 90%;">
                    <div class="modal-header" style="background: linear-gradient(135deg, #667eea, #764ba2); color: #fff; padding: 20px; border-radius: 16px 16px 0 0; display: flex; justify-content: space-between; align-items: center;">
                        <h3 style="margin: 0; color: #fff;">📱 QR-код посетителя</h3>
                        <button onclick="this.closest('.modal').remove()" class="close-btn" style="background: none; border: none; color: #fff; font-size: 20px; cursor: pointer; padding: 5px; border-radius: 50%; width: 30px; height: 30px;">✕</button>
                    </div>
                    <div style="text-align: center; padding: 20px;">
                        <img src="${qrUrl}" alt="QR код" style="max-width: 256px; border: 1px solid #ddd; border-radius: 8px;" 
                             onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
                        <div style="display: none; color: #999; padding: 40px;">QR код недоступен</div>
                        <div style="margin-top: 15px;">
                            <a href="${qrUrl}" download="qr-code.png" class="primary-btn" style="background: linear-gradient(135deg, #667eea, #764ba2); color: #fff; padding: 10px 20px; border-radius: 8px; text-decoration: none; display: inline-block;">📥 Скачать</a>
                        </div>
                    </div>
                </div>
            `;

            // Закрытие по клику вне модального окна
            modal.onclick = (e) => {
                if (e.target === modal) modal.remove();
            };

            document.body.appendChild(modal);

        } catch (err) {
            console.error('❌ Ошибка показа QR кода:', err);
            if (typeof utils !== 'undefined' && utils.showAlert) {
                utils.showAlert('error', 'Ошибка загрузки QR-кода');
            }
        }
    },

    // Редактирование посетителя (заглушка)
    async editVisitor(visitorId) {
        if (typeof utils !== 'undefined' && utils.showAlert) {
            utils.showAlert('info', 'Функция редактирования будет добавлена в следующем обновлении');
        }
    },

    // Изменение статуса посетителя
    async toggleStatus(visitorId, currentStatus) {
        const newStatus = currentStatus === 'active' ? 'blocked' : 'active';
        const action = newStatus === 'blocked' ? 'заблокировать' : 'разблокировать';

        if (!confirm(`Вы уверены, что хотите ${action} этого посетителя?`)) {
            return;
        }

        try {
            console.log(`🔄 Изменение статуса посетителя ${visitorId}: ${currentStatus} -> ${newStatus}`);

            const response = await fetch(`/api/visitors/${visitorId}/status`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `HTTP ${response.status}`);
            }

            const data = await response.json();

            if (typeof utils !== 'undefined' && utils.showAlert) {
                utils.showAlert('success', data.message);
            }

            this.loadList(this.currentPage);

        } catch (err) {
            console.error('❌ Ошибка изменения статуса:', err);
            if (typeof utils !== 'undefined' && utils.showAlert) {
                utils.showAlert('error', 'Ошибка изменения статуса: ' + err.message);
            }
        }
    },

    // Фильтрация
    filter() {
        this.filters.search = document.getElementById('search-input')?.value || '';
        this.filters.status = document.getElementById('status-filter')?.value || '';
        this.filters.event_id = document.getElementById('event-filter')?.value || '';

        console.log('🔍 Применение фильтров:', this.filters);
        this.loadList(1);
    },

    // Сброс фильтров
    resetFilters() {
        const searchInput = document.getElementById('search-input');
        const statusFilter = document.getElementById('status-filter');
        const eventFilter = document.getElementById('event-filter');

        if (searchInput) searchInput.value = '';
        if (statusFilter) statusFilter.value = '';
        if (eventFilter) eventFilter.value = '';

        this.filters = { search: '', status: '', event_id: '' };
        console.log('🔄 Фильтры сброшены');
        this.loadList(1);
    },

    // Генерация штрихкода
    generateBarcode() {
        const barcodeInput = document.getElementById('barcode');
        if (barcodeInput) {
            const newBarcode = this.createBarcode();
            barcodeInput.value = newBarcode;
            console.log('🎲 Сгенерирован штрихкод:', newBarcode);
        }
    },

    // Создание штрихкода
    createBarcode() {
        const date = new Date();
        const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
        const randomNum = Math.floor(Math.random() * 9000) + 1000;
        return `VIS${dateStr}${randomNum}`;
    },

    // Удаление фото
    removePhoto() {
        const photoInput = document.getElementById('photo');
        const preview = document.getElementById('photo-preview');

        if (photoInput) photoInput.value = '';
        if (preview) preview.classList.add('hidden');
    },

    // Сброс формы
    resetForm() {
        const form = document.getElementById('visitor-form');
        const resultContainer = document.getElementById('creation-result');
        const preview = document.getElementById('photo-preview');

        if (form) form.reset();
        if (resultContainer) resultContainer.classList.add('hidden');
        if (preview) preview.classList.add('hidden');

        console.log('🔄 Форма сброшена');
    },

    // Создать еще одного посетителя
    createAnother() {
        this.resetForm();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    // Утилиты форматирования
    formatDate(dateString) {
        if (!dateString) return '';
        try {
            return new Date(dateString).toLocaleDateString('ru-RU');
        } catch {
            return dateString;
        }
    },

    formatDateTime(dateString) {
        if (!dateString) return 'Нет данных';
        try {
            return new Date(dateString).toLocaleString('ru-RU');
        } catch {
            return dateString;
        }
    },

    getStatusText(status) {
        const statusMap = {
            'active': 'Активен',
            'blocked': 'Заблокирован',
            'inactive': 'Неактивен'
        };
        return statusMap[status] || status;
    },

    // Отображение ошибки
    displayError(message) {
        const container = document.getElementById('visitors-table');
        if (container) {
            container.innerHTML = `
                <div style="text-align: center; padding: 40px; color: #dc3545;">
                    <h3>❌ ${message}</h3>
                    <button onclick="visitors.loadList()" class="primary-btn" style="margin-top: 15px;">
                        🔄 Попробовать снова
                    </button>
                </div>
            `;
        }

        console.error('❌ Ошибка отображения:', message);
    }
};