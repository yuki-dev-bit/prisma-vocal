// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'dist-electron/**',
      'release/**',
      'coverage/**',
      'android/**',
      'build/**',
      'docs/screenshots/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Código de produção (renderer + core + shared)
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // O renderer escreve no console só em caminho de erro, com prefixo [prisma].
      'no-console': ['error', { allow: ['error'] }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
    },
  },

  // Processo principal do Electron e scripts de build (Node)
  {
    files: ['electron/**/*.ts', 'scripts/**/*.mjs', '*.config.ts', '*.config.js'],
    // Os scripts de smoke passam callbacks para `page.evaluate()`, que rodam no navegador:
    // por isso os globais de browser também valem aqui.
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      // Log é o produto aqui: o logger rotativo e os smokes precisam imprimir.
      'no-console': 'off',
    },
  },

  // AudioWorklet: roda em um contexto próprio, com globais que não existem em Node nem no DOM.
  {
    files: ['src/audio/capture-processor.js'],
    languageOptions: {
      globals: {
        AudioWorkletProcessor: 'readonly',
        registerProcessor: 'readonly',
        sampleRate: 'readonly',
        currentTime: 'readonly',
      },
    },
  },

  // Testes
  {
    files: ['tests/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
