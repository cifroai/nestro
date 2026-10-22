// Настройки приложения. После правки — npx tgcloud push.

// Short name Mini App, заданный в @BotFather (/newapp). Нужен для ссылок вида
// https://t.me/<бот>/<short name>?startapp=<id>.
export const APP_SHORT_NAME = 'rate';

// Telegram ID тех, кто может создавать и удалять кандидатов через чат с ботом.
// Свой ID можно узнать командой /myid. Пустой список — может любой, кто пишет боту.
export const ADMIN_IDS = [];

// Telegram ID тех, кто может загружать резюме. Пустой список — любой участник оценки.
export const RESUME_UPLOADER_IDS = [];

export const SCORE_MIN = 1;
export const SCORE_MAX = 10;

// Ограничение на размер резюме при загрузке из Mini App, МБ.
// Через чат с ботом (документ с подписью /resume <id>) можно присылать файлы до 20 МБ.
export const RESUME_MAX_MB = 10;

export const RESUME_EXTENSIONS = ['.pdf', '.doc', '.docx', '.rtf', '.odt', '.txt', '.jpg', '.jpeg', '.png'];

export const DECISIONS = {
  accept: 'Принять',
  reject: 'Отклонить',
  reserve: 'В резерв',
};
