// @ts-check
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Verbote im deterministischen Simulationskern (ADR-0004, CLAUDE.md Regel 3). */
const deterministicCore = {
  files: ['packages/sim/src/**/*.ts', 'packages/routing/src/**/*.ts'],
  ignores: ['**/*.test.ts', '**/*.perf.ts', '**/test-support.ts'],
  rules: {
    'no-restricted-globals': [
      'error',
      { name: 'Date', message: 'Im Sim-Kern nur Spielzeit (SimTime) verwenden.' },
      { name: 'performance', message: 'Keine Echtzeitmessung im Sim-Kern.' },
      { name: 'setTimeout', message: 'Keine Timer im Sim-Kern – EventQueue verwenden.' },
      { name: 'setInterval', message: 'Keine Timer im Sim-Kern – EventQueue verwenden.' },
      { name: 'window', message: 'Kein DOM im Sim-Kern.' },
      { name: 'document', message: 'Kein DOM im Sim-Kern.' },
      { name: 'process', message: 'Keine Node-APIs im Sim-Kern.' },
      { name: 'crypto', message: 'Zufall nur über Rng-Streams.' },
    ],
    'no-restricted-properties': [
      'error',
      { object: 'Math', property: 'random', message: 'Zufall nur über Rng-Streams.' },
      ...[
        'sin',
        'cos',
        'tan',
        'asin',
        'acos',
        'atan',
        'atan2',
        'exp',
        'log',
        'log2',
        'log10',
        'pow',
        // Math.sqrt ist erlaubt: IEEE 754 schreibt korrekt gerundete Ergebnisse vor.
        'cbrt',
        'hypot',
      ].map((property) => ({
        object: 'Math',
        property,
        message:
          'Transzendente Funktionen sind engine-abhängig – Geometrie zur Build-Zeit vorberechnen (ADR-0004).',
      })),
    ],
    'no-restricted-syntax': [
      'error',
      {
        selector: 'ForInStatement',
        message: 'for…in hat keine garantierte Reihenfolge – for…of verwenden.',
      },
    ],
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['node:*', 'electron', 'react', 'react-dom', '@ls112/desktop', '@ls112/ui'],
            message: 'Der Sim-Kern bleibt plattformunabhängig.',
          },
        ],
      },
    ],
  },
};

export default defineConfig(
  {
    ignores: [
      '**/dist/**',
      '**/out/**',
      '**/release/**',
      '**/coverage/**',
      '**/node_modules/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['*.js', '*.ts', 'scripts/*.mjs', 'apps/desktop/scripts/*.mjs'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-unnecessary-condition': [
        'error',
        { allowConstantLoopConditions: true },
      ],
      'no-restricted-exports': [
        'error',
        {
          restrictDefaultExports: {
            direct: true,
            named: true,
            defaultFrom: true,
            namedFrom: true,
            namespaceFrom: true,
          },
        },
      ],
    },
  },
  {
    files: ['**/*.js', '**/*.mjs', '**/*.config.ts', 'playwright.config.ts'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      ...tseslint.configs.disableTypeChecked.languageOptions,
      globals: globals.node,
    },
    rules: { ...tseslint.configs.disableTypeChecked.rules, 'no-restricted-exports': 'off' },
  },
  {
    files: ['apps/ui/src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/*.perf.ts', 'e2e/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  deterministicCore,
  prettier,
);
