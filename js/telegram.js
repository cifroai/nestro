// telegram.js — интеграция с Telegram WebApp SDK.
// Приложение работает и вне Telegram (в браузере), тогда SDK отсутствует.

const tg = window.Telegram?.WebApp || null;

export const Telegram = {
  available: !!tg,
  raw: tg,

  // Данные текущего пользователя Telegram (если доступны).
  user() {
    return tg?.initDataUnsafe?.user || null;
  },

  init() {
    if (!tg) return;
    tg.ready();
    tg.expand();
    // Тема применяется через CSS-переменные --tg-theme-*.
    tg.onEvent?.('themeChanged', () => document.body.dataset.tgTheme = tg.colorScheme);
    document.body.dataset.tgTheme = tg.colorScheme || 'light';
  },

  // Главная кнопка Telegram (внизу экрана).
  showMainButton(text, onClick) {
    if (!tg?.MainButton) return;
    tg.MainButton.setText(text);
    tg.MainButton.offClick?.(this._mainCb);
    this._mainCb = onClick;
    tg.MainButton.onClick(onClick);
    tg.MainButton.show();
  },

  hideMainButton() {
    tg?.MainButton?.hide();
  },

  // Кнопка «назад» в шапке Telegram.
  showBackButton(onClick) {
    if (!tg?.BackButton) return;
    tg.BackButton.offClick?.(this._backCb);
    this._backCb = onClick;
    tg.BackButton.onClick(onClick);
    tg.BackButton.show();
  },

  hideBackButton() {
    tg?.BackButton?.hide();
  },

  haptic(type = 'light') {
    tg?.HapticFeedback?.impactOccurred?.(type);
  },

  notify(type = 'success') {
    tg?.HapticFeedback?.notificationOccurred?.(type);
  },

  // Подтверждение — нативное в Telegram, иначе window.confirm.
  confirm(message) {
    return new Promise((resolve) => {
      if (tg?.showConfirm) {
        tg.showConfirm(message, (ok) => resolve(ok));
      } else {
        resolve(window.confirm(message));
      }
    });
  },

  alert(message) {
    if (tg?.showAlert) tg.showAlert(message);
    else window.alert(message);
  },

  // Отправка сводки в чат (если бот поддерживает inline-режим) либо копирование.
  async shareText(text) {
    // В Mini App нет прямого API «отправить в чат» без inline-режима,
    // поэтому копируем в буфер и уведомляем пользователя.
    try {
      await navigator.clipboard.writeText(text);
      this.alert('Сводка скопирована в буфер обмена.');
    } catch {
      this.alert('Не удалось скопировать. Выделите текст вручную.');
    }
  },
};
