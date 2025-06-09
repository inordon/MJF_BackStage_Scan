// js/visitors.js - Исправленный модуль управления посетителями с рабочим редактированием
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

    // Загрузка событий для фильтров и формы
    async loadEvents() {
        try {
            console.log('🎯 Загрузка событий...');

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

            if (typeof utils !== 'undefined' && utils.showAlert) {
                utils.showAlert('warning', 'Не удалось загрузить список событий');
            }
        }
    },

    // Обновление селекторов событий
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

        // Обновляем селектор в форме добавления
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

    // Загрузка списка посетителей с полной информацией
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

    // Отображение посетителей с полной информацией
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

    // ИСПРАВЛЕННАЯ функция редактирования посетителя
    async editVisitor(visitorId) {
        try {
            console.log('✏️ Редактирование посетителя ID:', visitorId);

            // Получаем данные посетителя
            const response = await fetch(`/api/visitors/${visitorId}`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const visitor = await response.json();
            console.log('📋 Данные посетителя:', visitor);

            // Показываем форму редактирования
            this.showEditForm(visitor);

        } catch (err) {
            console.error('❌ Ошибка загрузки данных посетителя:', err);
            if (typeof utils !== 'undefined' && utils.showAlert) {
                utils.showAlert('error', 'Ошибка загрузки данных посетителя: ' + err.message);
            }
        }
    },

    // НОВАЯ функция показа формы редактирования
    showEditForm(visitor) {
        // Удаляем существующую форму если есть
        this.hideEditForm();

        // Создаем модальное окно редактирования
        const modal = document.createElement('div');
        modal.id = 'edit-visitor-modal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>✏️ Редактирование посетителя</h3>
                    <button onclick="visitors.hideEditForm()" class="close-btn">✕</button>
                </div>

                <form id="edit-visitor-form">
                    <input type="hidden" id="edit-visitor-id" value="${visitor.id}">
                    
                    <div class="form-section">
                        <h4>📋 Основная информация</h4>
                        
                        <div class="form-row">
                            <div class="form-group">
                                <label for="edit-lastName">Фамилия *</label>
                                <input name="lastName" id="edit-lastName" value="${visitor.last_name || ''}" required>
                            </div>
                            <div class="form-group">
                                <label for="edit-firstName">Имя *</label>
                                <input name="firstName" id="edit-firstName" value="${visitor.first_name || ''}" required>
                            </div>
                        </div>

                        <div class="form-group">
                            <label for="edit-middleName">Отчество</label>
                            <input name="middleName" id="edit-middleName" value="${visitor.middle_name || ''}">
                        </div>

                        <div class="form-group">
                            <label for="edit-comment">Комментарий</label>
                            <textarea name="comment" id="edit-comment" rows="3">${visitor.comment || ''}</textarea>
                        </div>
                    </div>

                    <div class="form-section">
                        <h4>📊 Штрихкод</h4>
                        
                        <div class="form-group">
                            <label for="edit-barcode">Штрихкод</label>
                            <div style="display: flex; gap: 10px; align-items: end;">
                                <div style="flex: 1;">
                                    <input name="barcode" id="edit-barcode" value="${visitor.barcode || ''}" 
                                           ${auth.hasRole(['admin']) ? '' : 'readonly style="background: #f8f9fa;"'}>
                                    <small class="form-hint">
                                        ${auth.hasRole(['admin']) ?
            'Оставьте пустым для автоматической генерации' :
            'Только администраторы могут изменять штрихкод'
        }
                                    </small>
                                </div>
                                ${auth.hasRole(['admin']) ? `
                                    <button type="button" onclick="visitors.generateNewBarcode()" class="secondary-btn" style="margin-bottom: 20px;">
                                        🎲 Новый
                                    </button>
                                ` : ''}
                            </div>
                        </div>
                    </div>

                    ${auth.hasRole(['admin', 'moderator']) ? `
                        <div class="form-section">
                            <h4>⚙️ Статус</h4>
                            
                            <div class="form-group">
                                <label for="edit-status">Статус посетителя</label>
                                <select name="status" id="edit-status">
                                    <option value="active" ${visitor.status === 'active' ? 'selected' : ''}>✅ Активен</option>
                                    <option value="blocked" ${visitor.status === 'blocked' ? 'selected' : ''}>🚫 Заблокирован</option>
                                </select>
                            </div>
                        </div>
                    ` : ''}

                    <div class="modal-actions">
                        <button type="submit" class="primary-btn">
                            <span class="btn-text">💾 Сохранить изменения</span>
                            <span class="btn-loading hidden">🔄 Сохранение...</span>
                        </button>
                        <button type="button" onclick="visitors.hideEditForm()" class="secondary-btn">
                            ❌ Отмена
                        </button>
                    </div>
                </form>
            </div>
        `;

        // Добавляем в DOM
        document.body.appendChild(modal);

        // Настраиваем обработчик формы
        const form = document.getElementById('edit-visitor-form');
        form.addEventListener('submit', this.handleEditSubmit.bind(this));

        // Закрытие по клику вне модального окна
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                this.hideEditForm();
            }
        });

        console.log('✅ Форма редактирования показана');
    },

    // НОВАЯ функция скрытия формы редактирования
    hideEditForm() {
        const modal = document.getElementById('edit-visitor-modal');
        if (modal) {
            modal.remove();
        }
    },

    // НОВАЯ функция обработки отправки формы редактирования
    async handleEditSubmit(e) {
        e.preventDefault();

        const submitBtn = e.target.querySelector('button[type="submit"]');
        const btnText = submitBtn.querySelector('.btn-text');
        const btnLoading = submitBtn.querySelector('.btn-loading');

        try {
            // Показываем индикатор загрузки
            submitBtn.disabled = true;
            btnText.classList.add('hidden');
            btnLoading.classList.remove('hidden');

            const visitorId = document.getElementById('edit-visitor-id').value;
            const formData = new FormData(e.target);

            // Собираем данные
            const visitorData = {
                lastName: formData.get('lastName'),
                firstName: formData.get('firstName'),
                middleName: formData.get('middleName') || null,
                comment: formData.get('comment') || null,
                barcode: formData.get('barcode') || null
            };

            // Добавляем статус если есть права
            if (auth.hasRole(['admin', 'moderator'])) {
                visitorData.status = formData.get('status');
            }

            console.log('📝 Отправка данных обновления:', visitorData);

            const response = await fetch(`/api/visitors/${visitorId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(visitorData)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `HTTP ${response.status}`);
            }

            const data = await response.json();
            console.log('✅ Посетитель обновлен:', data);

            if (typeof utils !== 'undefined' && utils.showAlert) {
                utils.showAlert('success', 'Посетитель успешно обновлен!');
            }

            // Закрываем форму и обновляем список
            this.hideEditForm();

            // Обновляем список посетителей если мы на главной странице
            if (typeof this.loadList === 'function') {
                this.loadList(this.currentPage || 1);
            }

        } catch (err) {
            console.error('❌ Ошибка обновления посетителя:', err);
            if (typeof utils !== 'undefined' && utils.showAlert) {
                utils.showAlert('error', err.message);
            }
        } finally {
            // Возвращаем кнопку в исходное состояние
            submitBtn.disabled = false;
            btnText.classList.remove('hidden');
            btnLoading.classList.add('hidden');
        }
    },

    // НОВАЯ функция генерации нового штрихкода в форме редактирования
    generateNewBarcode() {
        const barcodeInput = document.getElementById('edit-barcode');
        if (barcodeInput && auth.hasRole(['admin'])) {
            const newBarcode = this.createBarcode();
            barcodeInput.value = newBarcode;
            console.log('🎲 Сгенерирован новый штрихкод:', newBarcode);
        } else {
            if (typeof utils !== 'undefined' && utils.showAlert) {
                utils.showAlert('warning', 'Только администраторы могут генерировать новые штрихкоды');
            }
        }
    },

    // Остальные существующие методы...

    updateVisitorsCount(total) {
        const counter = document.getElementById('visitors-count');
        if (counter) {
            counter.textContent = `${total} посетителей`;
        }
    },

    updatePagination(pagination) {
        this.currentPage = pagination.page;
        this.totalPages = pagination.pages;

        if (typeof utils !== 'undefined' && utils.renderPagination) {
            utils.renderPagination('visitors-pagination', pagination, 'visitors.loadList');
        }
    },

    setupFormHandlers() {
        const form = document.getElementById('visitor-form');
        if (form) {
            form.addEventListener('submit', this.handleFormSubmit.bind(this));
            console.log('✅ Обработчики формы настроены');
        }
    },

    async handleFormSubmit(e) {
        e.preventDefault();
        console.log('📝 Отправка формы создания посетителя');

        const submitBtn = e.target.querySelector('button[type="submit"]');
        const btnText = submitBtn.querySelector('.btn-text');
        const btnLoading = submitBtn.querySelector('.btn-loading');

        try {
            submitBtn.disabled = true;
            if (btnText) btnText.classList.add('hidden');
            if (btnLoading) btnLoading.classList.remove('hidden');

            const formData = new FormData(e.target);

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
            submitBtn.disabled = false;
            if (btnText) btnText.classList.remove('hidden');
            if (btnLoading) btnLoading.classList.add('hidden');
        }
    },

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

            if (visitor.barcode) {
                this.generateQRCode(visitor.barcode);
            }

            resultContainer.classList.remove('hidden');
            resultContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    },

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
        }
    },

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
                        <button onclick="this.closest('.modal').remove()" class="close-btn" style="background: none; border: none; color: #fff; font-size: 20px; cursor: pointer;">✕</button>
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

    filter() {
        this.filters.search = document.getElementById('search-input')?.value || '';
        this.filters.status = document.getElementById('status-filter')?.value || '';
        this.filters.event_id = document.getElementById('event-filter')?.value || '';

        console.log('🔍 Применение фильтров:', this.filters);
        this.loadList(1);
    },

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

    generateBarcode() {
        const barcodeInput = document.getElementById('barcode');
        if (barcodeInput) {
            const newBarcode = this.createBarcode();
            barcodeInput.value = newBarcode;
            console.log('🎲 Сгенерирован штрихкод:', newBarcode);
        }
    },

    createBarcode() {
        const date = new Date();
        const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
        const randomNum = Math.floor(Math.random() * 9000) + 1000;
        return `VIS${dateStr}${randomNum}`;
    },

    removePhoto() {
        const photoInput = document.getElementById('photo');
        const preview = document.getElementById('photo-preview');

        if (photoInput) photoInput.value = '';
        if (preview) preview.classList.add('hidden');
    },

    resetForm() {
        const form = document.getElementById('visitor-form');
        const resultContainer = document.getElementById('creation-result');
        const preview = document.getElementById('photo-preview');

        if (form) form.reset();
        if (resultContainer) resultContainer.classList.add('hidden');
        if (preview) preview.classList.add('hidden');

        console.log('🔄 Форма сброшена');
    },

    createAnother() {
        this.resetForm();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    downloadQR() {
        const canvas = document.getElementById('qr-canvas');
        if (canvas) {
            const link = document.createElement('a');
            link.download = 'visitor-qr-code.png';
            link.href = canvas.toDataURL();
            link.click();
        }
    },

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