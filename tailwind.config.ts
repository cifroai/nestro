import type { Config } from 'tailwindcss';

/**
 * Корпоративная инженерная палитра.
 * ВАЖНО (docs/ARCHITECTURE.md §7): `danger` используется ИСКЛЮЧИТЕЛЬНО для
 * технических предупреждений интерфейса (ошибка сохранения, истёкшая сессия).
 * Уровни компетенций кодируются шкалой `level-0..4` (насыщенность нейтрального
 * акцента) и текстовой подписью, но никогда не «светофором».
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        graphite: {
          50: '#f6f7f8', 100: '#eceef1', 200: '#d5d9df', 300: '#b0b8c2',
          400: '#84909f', 500: '#647283', 600: '#4e5a69', 700: '#404955',
          800: '#373e48', 900: '#31363e', 950: '#1c2025',
        },
        accent: {
          50: '#eef2ff', 100: '#e0e7ff', 200: '#c7d2fe', 300: '#a5b4fc',
          400: '#818cf8', 500: '#6366f1', 600: '#4f46e5', 700: '#4338ca',
          800: '#3730a3', 900: '#312e81',
        },
        // Уровни 0..4 — нейтральная монохромная шкала (не оценка человека).
        level: {
          0: '#d5d9df', 1: '#b0b8c2', 2: '#818cf8', 3: '#4f46e5', 4: '#3730a3',
        },
        danger: { 50: '#fef2f2', 500: '#dc2626', 700: '#b91c1c' },
        warnTech: { 50: '#fffbeb', 500: '#d97706' },
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '"Segoe UI"', 'Roboto', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', '"JetBrains Mono"', 'Menlo', 'Consolas', 'monospace'],
      },
      fontSize: { '2xs': ['0.6875rem', '1rem'] },
    },
  },
  plugins: [],
};
export default config;
