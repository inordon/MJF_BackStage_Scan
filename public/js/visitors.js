// js/visitors.js - Модуль управления посетителями
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
        await this.loadEvents();
        this.setupFormHandlers();
    },

    // Загрузка событий для фильтров и формы
    async loadEvents() {
        try {
            console.log('🎯 Загрузка событий...');
            const response = await fetch('/api/visitors/events/active');
            const data = await response.json();

            if (data.success && data.events) {
                this.events = data.events;
                this.updateEventSelectors();
                console.log(`✅ Загружено событий: ${this.events.length}`);
            } else {
                console.warn('⚠️ Нет активных событий или ошибка загрузки');
                this.events = [];
                this.updateEventSelectors();
            }
        } catch (err) {
            console.error('❌ Ошибка загрузки событий:', err);
            this.events = [];
            this.updateEventSelectors();
        }
    },

    // Обновление селекторов событий
    updateEventSelectors() {
        // Обновляем фильтр событий (на главной странице)
        const eventFilter = document.getElementById('event-filter');
        if (eventFilter) {
            eventFilter.innerHTML = '<option value="">Все события</option>';
            this.events.forEach(event => {
                const option = document.createElement('option');
                option.value = event.id;
                option.textContent = `${event.name} (${utils.formatDate(event.start_date)} - ${utils.formatDate(event.end_date)})`;
                eventFilter.appendChild(option);
            });
        }

        // Обновляем селектор в форме добавления (на странице visitors.html)
        const eventSelect = document.getElementById('eventId');
        if (eventSelect) {
            if (this.events.length === 0) {
                eventSelect.innerHTML = '<option value="">❌ Нет активных событий</option>';
                eventSelect.disabled = true;
            } else {
                eventSelect.innerHTML = '<option value="">Выберите событие</option>';
                this.events.forEach(event => {
                    const option = document.createElement('option');
                    option.value = event.id;
                    option.textContent = event.name;
                    eventSelect.appendChild(option);
                });
                eventSelect.disabled = false;
            }
        }
    },

    // Загрузка списка посетителей
    async loadList(page = 1) {
        try {
            const params = new URLSearchParams({
                page: page,
                limit: 25,
                ...this.filters
            });

            const response = await fetch(`/api/visitors?${params}`);
            const data = await response.json();

            this.displayVisitors(data.visitors);
            this.updatePagination(data.pagination);
            this.updateVisitorsCount(data.pagination.total);

        } catch (err) {
            console.error('Ошибка загрузки посетителей:', err);
            this.displayError('Ошибка загрузки списка посетителей');
        }
    },

    // Отображение посетителей
    displayVisitors(visitors) {
        const container = document.getElementById('visitors-table');
        if (!container) return;

        if (!visitors || visitors.length === 0) {
            container.innerHTML = '<div class="empty">Посетители не найдены</div>';
            return;
        }

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
                        <tr>
                            <td>
                                <strong>${visitor.last_name} ${visitor.first_name}</strong>
                                ${visitor.middle_name ? `<br><small>${visitor.middle_name}</small>` : ''}
                                ${visitor.comment ? `<br><em>${visitor.comment}</em>` : ''}
                            </td>
                            <td>
                                ${visitor.event ? visitor.event.name : 'Без события'}
                                ${visitor.event ? `<br><small>${utils.formatDate(visitor.event.start_date)}</small>` : ''}
                            </td>
                            <td>
                                <code>${visitor.barcode}</code>
                                ${visitor.first_scan_today ? '<br><span class="badge">Сканировался сегодня</span>' : ''}
                            </td>
                            <td>
                                <span class="status-${visitor.status}">${utils.getStatusText(visitor.status)}</span>
                            </td>
                            <td>
                                ${visitor.total_scans} раз
                                ${visitor.last_scan ? `<br><small>Последний: ${utils.formatDateTime(visitor.last_scan)}</small>` : ''}
                            </td>
                            <td>
                                ${utils.formatDate(visitor.created_at)}
                                ${visitor.created_by_name ? `<br><small>${visitor.created_by_name}</small>` : ''}
                            </td>
                            <td>
                                <button onclick="visitors.viewQR(${visitor.id})" class="secondary-btn" title="Показать QR-код">
                                    📱
                                </button>
                                ${auth.hasRole(['admin', 'moderator']) ? `
                                    <button onclick="visitors.editVisitor(${visitor.id})" class="secondary-btn" title="Редактировать">
                                        ✏️
                                    </button>
                                    <button onclick="visitors.toggleStatus(${visitor.id}, '${visitor.status}')" 
                                            class="secondary-btn" 
                                            title="${visitor.status === 'active' ? 'Заблокировать' : 'Разблокировать'}">
                                        ${visitor.status === 'active' ? '🚫' : '✅'}
                                    </button>
                                ` : ''}
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;

        container.innerHTML = table;
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

        utils.renderPagination('visitors-pagination', pagination, 'visitors.loadList');
    },

    // Настройка обработчиков формы
    setupFormHandlers() {
        const form = document.getElementById('visitor-form');
        if (form) {
            form.addEventListener('submit', this.handleFormSubmit.bind(this));
        }
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

            const response = await fetch('/api/visitors', {
                method: 'POST',
                body: formData
            });

            const data = await response.json();

            if (response.ok) {
                this.showCreationResult(data.visitor);
                this.resetForm();
                utils.showAlert('success', 'Посетитель успешно создан!');
            } else {
                throw new Error(data.error || 'Ошибка создания посетителя');
            }

        } catch (err) {
            console.error('Ошибка создания посетителя:', err);
            utils.showAlert('error', err.message);
        } finally {
            // Возвращаем кнопку в исходное состояние
            submitBtn.disabled = false;
            btnText.classList.remove('hidden');
            btnLoading.classList.add('hidden');
        }
    },

    // Показ результата создания
    showCreationResult(visitor) {
        const resultContainer = document.getElementById('creation-result');
        const visitorInfo = document.getElementById('visitor-info');

        if (resultContainer && visitorInfo) {
            visitorInfo.innerHTML = `
                <p><strong>ФИО:</strong> ${visitor.last_name} ${visitor.first_name} ${visitor.middle_name || ''}</p>
                <p><strong>Событие:</strong> ${visitor.event_name}</p>
                <p><strong>Штрихкод:</strong> <code>${visitor.barcode}</code></p>
                ${visitor.comment ? `<p><strong>Комментарий:</strong> ${visitor.comment}</p>` : ''}
            `;

            // Генерируем QR код
            this.generateQRCode(visitor.barcode);

            resultContainer.classList.remove('hidden');

            // Прокручиваем к результату
            resultContainer.scrollIntoView({ behavior: 'smooth' });
        }
    },

    // Генерация QR кода
    generateQRCode(barcode) {
        const canvas = document.getElementById('qr-canvas');
        if (canvas && window.qrcode) {
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

    // Просмотр QR кода
    async viewQR(visitorId) {
        try {
            const qrUrl = `/api/visitors/${visitorId}/qr`;
            const modal = `
                <div class="modal">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h3>📱 QR-код посетителя</h3>
                            <button onclick="this.closest('.modal').remove()" class="close-btn">✕</button>
                        </div>
                        <div style="text-align: center; padding: 20px;">
                            <img src="${qrUrl}" alt="QR код" style="max-width: 256px; border: 1px solid #ddd; border-radius: 8px;">
                            <div style="margin-top: 15px;">
                                <a href="${qrUrl}" download="qr-code.png" class="primary-btn">📥 Скачать</a>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            document.body.insertAdjacentHTML('beforeend', modal);
        } catch (err) {
            utils.showAlert('error', 'Ошибка загрузки QR-кода');
        }
    },

    // Редактирование посетителя (заглушка)
    async editVisitor(visitorId) {
        utils.showAlert('info', 'Функция редактирования будет добавлена в следующем обновлении');
    },

    // Изменение статуса посетителя
    async toggleStatus(visitorId, currentStatus) {
        const newStatus = currentStatus === 'active' ? 'blocked' : 'active';
        const action = newStatus === 'blocked' ? 'заблокировать' : 'разблокировать';

        if (!confirm(`Вы уверены, что хотите ${action} этого посетителя?`)) {
            return;
        }

        try {
            const response = await fetch(`/api/visitors/${visitorId}/status`, {
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
        this.filters.search = document.getElementById('search-input')?.value || '';
        this.filters.status = document.getElementById('status-filter')?.value || '';
        this.filters.event_id = document.getElementById('event-filter')?.value || '';

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
        this.loadList(1);
    },

    // Генерация штрихкода
    generateBarcode() {
        const barcodeInput = document.getElementById('barcode');
        if (barcodeInput) {
            const newBarcode = utils.generateBarcode();
            barcodeInput.value = newBarcode;
        }
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
    },

    // Создать еще одного посетителя
    createAnother() {
        this.resetForm();
        window.scrollTo(0, 0);
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
    }
};