import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import js from '@eslint/js';
import { FlatCompat } from '@eslint/eslintrc';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

/**
 * Конфигурация статического анализа (flat config, ESLint 9).
 *
 * Проверка выполняется без информации о типах: типы полностью покрыты
 * `tsc --noEmit` в strict-режиме, а линтер отвечает за то, что типами
 * не проверяется, — необработанные промисы уровня синтаксиса, неиспользуемый
 * код и правила Next.js.
 */

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  {
    ignores: [
      '.next/**',
      // Файл генерируется Next.js при сборке.
      'next-env.d.ts',
      'node_modules/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'src/generated/**',
    ],
  },
  js.configs.recommended,
  ...compat.extends('next/core-web-vitals'),
  {
    files: ['**/*.{ts,tsx,mts}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 2023, sourceType: 'module' },
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      // Проверяется компилятором; дублирование даёт ложные срабатывания
      // на глобальных типах Node и браузера.
      'no-undef': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Оценочные формулировки в интерфейсе кандидата контролируются
      // отдельной проверкой словаря (tests/unit/forbiddenVocabulary.test.ts).
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
    },
  },
  {
    files: ['tests/**/*.ts', 'scripts/**/*.ts', 'prisma/**/*.ts'],
    rules: {
      // В тестах и служебных скриптах допустимы обращения к внутренним
      // структурам без явной типизации фикстур.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
];

export default config;
