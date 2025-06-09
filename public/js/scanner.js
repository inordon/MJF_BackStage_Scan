// js/scanner.js - Модуль QR сканирования
const scanner = {
    qrScanner: null,
    isScanning: false,
    recentScans: [],
    cameras: [],
    currentCameraIndex: 0,

    // Инициализация сканера
    async init() {
        this.setupEventListeners();
        await this.loadRecentScans();
        this.checkCameraSupport();
    },

    // Проверка поддержки камеры
    async checkCameraSupport() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            this.showError('Камера не поддерживается вашим браузером');
            return false;
        }

        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            this.cameras = devices.filter(device => device.kind === 'videoinput');

            if (this.cameras.length === 0) {
                this.showError('Камера не найдена');
                return false;
            }

            console.log(`Найдено камер: ${this.cameras.length}`);
            return true;
        } catch (err) {
            console.error('Ошибка проверки камер:', err);
            this.showError('Ошибка доступа к камере');
            return false;
        }
    },

    // Настройка обработчиков событий
    setupEventListeners() {
        const manualForm = document.getElementById('manual-scan-form');
        if (manualForm) {
            manualForm.addEventListener('submit', this.handleManualScan.bind(this));
        }
    },

    // Переключение сканера
    async toggle() {
        if (this.isScanning) {
            this.stopScanner();
        } else {
            await this.startScanner();
        }
    },

    // Запуск сканера
    async startScanner() {
        try {
            if (!await this.checkCameraSupport()) {
                return;
            }

            const video = document.getElementById('qr-video');
            const btn = document.getElementById('scanner-btn');

            if (!video || !btn) {
                this.showError('Элементы сканера не найдены');
                return;
            }

            console.log('Запуск QR сканера...');

            // Настройки камеры
            const constraints = {
                video: {
                    facingMode: 'environment', // Задняя камера
                    width: { ideal: 640 },
                    height: { ideal: 480 }
                }
            };

            // Если есть несколько камер, используем выбранную
            if (this.cameras.length > 0 && this.cameras[this.currentCameraIndex]) {
                constraints.video.deviceId = this.cameras[this.currentCameraIndex].deviceId;
            }

            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            video.srcObject = stream;
            video.classList.remove('hidden');

            await video.play();

            // Инициализируем QR сканер если доступен
            if (window.QrScanner) {
                this.qrScanner = new QrScanner(
                    video,
                    this.handleScanResult.bind(this),
                    {
                        highlightScanRegion: true,
                        highlightCodeOutline: true,
                        maxScansPerSecond: 2
                    }
                );
                await this.qrScanner.start();
            } else {
                // Fallback - обработка вручную
                console.warn('QrScanner библиотека недоступна, используем fallback');
                this.startManualScanning(video);
            }

            this.isScanning = true;
            btn.textContent = '⏹️ Остановить сканер';
            btn.classList.remove('primary-btn');
            btn.classList.add('secondary-btn');

            console.log('✅ QR сканер запущен');

        } catch (err) {
            console.error('Ошибка запуска сканера:', err);
            this.showError('Не удалось запустить камеру: ' + err.message);
        }
    },

    // Остановка сканера
    stopScanner() {
        const video = document.getElementById('qr-video');
        const btn = document.getElementById('scanner-btn');

        if (this.qrScanner) {
            this.qrScanner.stop();
            this.qrScanner.destroy();
            this.qrScanner = null;
        }

        if (video) {
            const stream = video.srcObject;
            if (stream) {
                stream.getTracks().forEach(track => track.stop());
            }
            video.srcObject = null;
            video.classList.add('hidden');
        }

        this.isScanning = false;

        if (btn) {
            btn.textContent = '📹 Запустить сканер';
            btn.classList.remove('secondary-btn');
            btn.classList.add('primary-btn');
        }

        console.log('⏹️ QR сканер остановлен');
    },

    // Переключение камеры
    async switchCamera() {
        if (!this.isScanning || this.cameras.length <= 1) {
            return;
        }

        this.currentCameraIndex = (this.currentCameraIndex + 1) % this.cameras.length;

        // Перезапускаем сканер с новой камерой
        this.stopScanner();
        await this.startScanner();

        utils.showAlert('info', `Переключено на камеру ${this.currentCameraIndex + 1} из ${this.cameras.length}`);
    },

    // Простое сканирование без QrScanner библиотеки
    startManualScanning(video) {
        utils.showAlert('warning', 'Автоматическое сканирование недоступно. Используйте ручной ввод штрихкода.');
    },

    // Обработка результата сканирования
    async handleScanResult(result) {
        if (!result) return;

        const barcode = result.data || result;
        console.log('🔍 Отсканирован штрихкод:', barcode);

        try {
            // Временно останавливаем сканер чтобы избежать дублирования
            if (this.qrScanner) {
                this.qrScanner.stop();
            }

            await this.processScan(barcode);

            // Возобновляем сканирование через 2 секунды
            setTimeout(() => {
                if (this.isScanning && this.qrScanner) {
                    this.qrScanner.start();
                }
            }, 2000);

        } catch (err) {
            console.error('Ошибка обработки сканирования:', err);
            utils.showAlert('error', 'Ошибка обработки штрихкода');

            // Возобновляем сканирование при ошибке
            setTimeout(() => {
                if (this.isScanning && this.qrScanner) {
                    this.qrScanner.start();
                }
            }, 1000);
        }
    },

    // Обработка ручного ввода
    async handleManualScan(e) {
        e.preventDefault();

        const barcodeInput = document.getElementById('manual-barcode');
        const barcode = barcodeInput.value.trim();

        if (!barcode) {
            utils.showAlert('warning', 'Введите штрихкод');
            return;
        }

        console.log('✏️ Ручной ввод штрихкода:', barcode);

        try {
            await this.processScan(barcode);
            barcodeInput.value = '';
        } catch (err) {
            console.error('Ошибка ручного сканирования:', err);
            utils.showAlert('error', 'Ошибка обработки штрихкода');
        }
    },

    // Обработка сканирования
    async processScan(barcode) {
        try {
            // Проверяем не был ли этот штрихкод отсканирован недавно (избегаем дублирования)
            const recentScan = this.recentScans.find(scan =>
                scan.barcode === barcode &&
                Date.now() - scan.timestamp < 30000 // 30 секунд
            );

            if (recentScan) {
                utils.showAlert('warning', 'Этот штрихкод был недавно отсканирован');
                return;
            }

            console.log(`🔍 Сканирование штрихкода: ${barcode}`);

            const response = await fetch(`/api/scan/${barcode}`);
            const result = await response.json();

            console.log('📊 Результат сканирования:', result);

            // Добавляем в историю
            this.addToRecentScans({
                barcode: barcode,
                timestamp: Date.now(),
                result: result
            });

            // Показываем результат
            this.displayScanResult(result);

            // Обновляем историю
            this.updateRecentScansDisplay();

        } catch (err) {
            console.error('❌ Ошибка сканирования:', err);

            const errorResult = {
                status: 'error',
                type: 'system_error',
                icon: 'ℹ️',
                title: 'Ошибка системы',
                message: 'Не удалось обработать штрихкод',
                barcode: barcode
            };

            this.displayScanResult(errorResult);
        }
    },

    // Отображение результата сканирования
    displayScanResult(result) {
        const container = document.getElementById('scan-result');
        if (!container) return;

        const timestamp = new Date().toLocaleTimeString('ru-RU');

        let content = '';
        let alertType = 'info';

        switch (result.status) {
            case 'success':
                alertType = 'success';
                content = `
                    <div class="scan-success">
                        <div style="font-size: 3em; margin-bottom: 15px;">✅</div>
                        <h2>${result.title}</h2>
                        ${result.comment ? `<p style="font-style: italic; margin: 10px 0;">"${result.comment}"</p>` : ''}
                        <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin: 15px 0;">
                            <strong>Штрихкод:</strong> <code>${result.barcode}</code><br>
                            <strong>Время:</strong> ${timestamp}<br>
                            <strong>Статус:</strong> ${result.message}
                        </div>
                    </div>
                `;
                break;

            case 'warning':
                alertType = 'warning';
                content = `
                    <div class="scan-warning">
                        <div style="font-size: 3em; margin-bottom: 15px;">⚠️</div>
                        <h2>${result.title}</h2>
                        ${result.comment ? `<p style="font-style: italic; margin: 10px 0;">"${result.comment}"</p>` : ''}
                        <div style="background: #fff3cd; padding: 15px; border-radius: 8px; margin: 15px 0;">
                            <strong>Штрихкод:</strong> <code>${result.barcode}</code><br>
                            <strong>Время:</strong> ${timestamp}<br>
                            <strong>Первое сканирование:</strong> ${result.firstScanTime ? new Date(result.firstScanTime).toLocaleString('ru-RU') : 'Неизвестно'}<br>
                            <strong>Статус:</strong> ${result.message}
                        </div>
                    </div>
                `;
                break;

            case 'error':
                alertType = 'error';
                content = `
                    <div class="scan-error">
                        <div style="font-size: 3em; margin-bottom: 15px;">❌</div>
                        <h2>${result.title || 'ПРОХОД ЗАПРЕЩЕН'}</h2>
                        <div style="background: #f8d7da; padding: 15px; border-radius: 8px; margin: 15px 0;">
                            <strong>Штрихкод:</strong> <code>${result.barcode}</code><br>
                            <strong>Время:</strong> ${timestamp}<br>
                            <strong>Причина:</strong> ${result.message}<br>
                            <strong>Рекомендация:</strong> Обратитесь к организатору
                        </div>
                    </div>
                `;
                break;

            default:
                content = `
                    <div class="scan-info">
                        <div style="font-size: 3em; margin-bottom: 15px;">ℹ️</div>
                        <h2>${result.title || 'Информация'}</h2>
                        <div style="background: #d1ecf1; padding: 15px; border-radius: 8px; margin: 15px 0;">
                            <strong>Штрихкод:</strong> <code>${result.barcode}</code><br>
                            <strong>Время:</strong> ${timestamp}<br>
                            <strong>Сообщение:</strong> ${result.message}
                        </div>
                    </div>
                `;
        }

        container.innerHTML = content;
        container.classList.remove('hidden');

        // Показываем уведомление
        utils.showAlert(alertType, result.message || 'Сканирование завершено');

        // Автоматически скрываем результат через 10 секунд
        setTimeout(() => {
            container.classList.add('hidden');
        }, 10000);
    },

    // Добавление в историю сканирований
    addToRecentScans(scan) {
        this.recentScans.unshift(scan);

        // Ограничиваем количество записей
        if (this.recentScans.length > 10) {
            this.recentScans = this.recentScans.slice(0, 10);
        }

        // Сохраняем в localStorage
        try {
            localStorage.setItem('recentScans', JSON.stringify(this.recentScans));
        } catch (err) {
            console.warn('Не удалось сохранить историю сканирований:', err);
        }
    },

    // Загрузка истории сканирований
    async loadRecentScans() {
        try {
            const saved = localStorage.getItem('recentScans');
            if (saved) {
                this.recentScans = JSON.parse(saved);
            }
        } catch (err) {
            console.warn('Не удалось загрузить историю сканирований:', err);
            this.recentScans = [];
        }

        this.updateRecentScansDisplay();
    },

    // Обновление отображения истории
    updateRecentScansDisplay() {
        const container = document.getElementById('recent-scans');
        if (!container) return;

        if (this.recentScans.length === 0) {
            container.innerHTML = '<div class="empty">История сканирований пуста</div>';
            return;
        }

        const scansHtml = this.recentScans.slice(0, 5).map(scan => {
            const time = new Date(scan.timestamp).toLocaleTimeString('ru-RU');
            const result = scan.result;

            let statusIcon = '📱';
            let statusClass = 'info';

            if (result.status === 'success') {
                statusIcon = '✅';
                statusClass = 'success';
            } else if (result.status === 'warning') {
                statusIcon = '⚠️';
                statusClass = 'warning';
            } else if (result.status === 'error') {
                statusIcon = '❌';
                statusClass = 'error';
            }

            return `
                <div class="activity-item">
                    <div class="activity-icon">${statusIcon}</div>
                    <div class="activity-details">
                        <div class="activity-text">
                            <strong>${result.title || scan.barcode}</strong>
                        </div>
                        <div class="activity-time">
                            ${time} • ${result.message || 'Сканирование'}
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        container.innerHTML = `
            <div class="activity-list">
                ${scansHtml}
                ${this.recentScans.length > 5 ? `
                    <div style="text-align: center; margin-top: 15px;">
                        <small>И еще ${this.recentScans.length - 5} сканирований...</small>
                    </div>
                ` : ''}
            </div>
        `;
    },

    // Показ ошибки
    showError(message) {
        const container = document.getElementById('scan-result');
        if (container) {
            container.innerHTML = `
                <div class="scan-error" style="text-align: center; padding: 30px;">
                    <div style="font-size: 3em; margin-bottom: 15px;">⚠️</div>
                    <h3>${message}</h3>
                    <p style="margin-top: 15px; color: #666;">
                        Попробуйте использовать ручной ввод штрихкода
                    </p>
                </div>
            `;
            container.classList.remove('hidden');
        }

        utils.showAlert('error', message);
    },

    // Очистка истории
    clearHistory() {
        this.recentScans = [];
        try {
            localStorage.removeItem('recentScans');
        } catch (err) {
            console.warn('Ошибка очистки истории:', err);
        }
        this.updateRecentScansDisplay();
        utils.showAlert('success', 'История сканирований очищена');
    }
};