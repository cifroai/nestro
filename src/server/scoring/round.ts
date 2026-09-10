/**
 * Единая утилита округления. Половина — вверх, три знака.
 * Нужна для побитовой воспроизводимости на разных платформах (§60).
 */
export function round3(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const scaled = value * 1000;
  const rounded = Math.sign(scaled) * Math.round(Math.abs(scaled) + Number.EPSILON * Math.abs(scaled));
  return rounded / 1000;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Выборочное стандартное отклонение (n−1); при n<2 возвращает 0. */
export function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((acc, v) => acc + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}
