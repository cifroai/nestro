/** Форматирование значений для интерфейса (локаль ru-RU). */

export function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return value.toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatPercent(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined) return '—';
  return `${(value * 100).toLocaleString('ru-RU', { maximumFractionDigits: digits })}%`;
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
}

export function formatDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return '—';
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return hours > 0 ? `${hours} ч ${rest} мин` : `${rest} мин`;
}

export const LEVEL_LABELS: Record<number, string> = {
  0: 'отсутствует',
  1: 'декларативный',
  2: 'операционный',
  3: 'системный',
  4: 'экспертный',
};

export const BAND_LABELS: Record<string, string> = {
  EXPERT: 'выраженный экспертный уровень',
  HIGH: 'высокий профессиональный уровень',
  SUFFICIENT: 'достаточный / требует проверки отдельных компетенций',
  GAPS: 'имеются существенные квалификационные пробелы',
  NOT_CONFIRMED: 'текущие ответы не подтверждают требуемый уровень',
  INSUFFICIENT_DATA: 'недостаточно данных',
};

export const AXIS_LABELS: Record<string, string> = {
  TECHNICAL_REASONING: 'Техническое мышление',
  SYSTEM_THINKING: 'Системное мышление',
  RISK_MANAGEMENT: 'Управление риском',
  PREVENTIVE_THINKING: 'Превентивное мышление',
  DECISION_MAKING: 'Принятие решений',
  OPERATIONAL_MATURITY: 'Операционная зрелость',
  COMMUNICATION: 'Коммуникация',
  SELF_AWARENESS: 'Профессиональная рефлексия',
};

export const SECTION_LABELS: Record<string, string> = {
  INTRO: 'Введение',
  KELLY_TRIADS: 'Профессиональные критерии',
  REPERTORY_GRID: 'Оценка специалистов',
  LADDERING: 'Уточнение значимости',
  SJT_CASES: 'Ситуационные кейсы',
  ARGUMENTATION: 'Профессиональная аргументация',
  SELF_RATING: 'Самооценка',
  FINISH: 'Завершение',
};

export const STATUS_LABELS: Record<string, string> = {
  NOT_STARTED: 'не начата',
  IN_PROGRESS: 'в процессе',
  COMPLETED: 'завершена',
  EXPIRED: 'срок истёк',
  ABANDONED: 'прервана',
  CREATED: 'создано',
  SENT: 'отправлено',
  OPENED: 'открыто',
  REVIEWED: 'проверено',
  PENDING: 'ожидает обработки',
  RUNNING: 'обрабатывается',
  DONE: 'оценено',
  FAILED: 'ошибка обработки',
  MANUAL_ONLY: 'только ручная оценка',
};
