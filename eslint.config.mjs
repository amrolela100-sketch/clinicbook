import { FlatCompat } from '@eslint/eslintrc';
import js from '@eslint/js';
import globals from 'globals';
import { fileURLToPath } from 'node:url';

const compat = new FlatCompat({
  baseDirectory: fileURLToPath(new URL('.', import.meta.url)),
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

const config = [
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'test-results/**',
      'playwright-report/**',
      'coverage/**',
      'data/**',
      'docs/**',
      'public/**',
      'supabase/**',
      'next-env.d.ts',
    ],
  },
  ...compat.extends('eslint:recommended', 'next/core-web-vitals', 'next/typescript'),
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx,mts}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      eqeqeq: ['error', 'always'],
      'no-debugger': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    files: ['**/*.{ts,tsx,mts}'],
    // TypeScript checks undefined symbols; core no-undef misreads type-only names.
    rules: { 'no-undef': 'off' },
  },
  {
    files: ['tests/**/*.ts'],
    // Test adapters model fluent third-party clients whose callback values are
    // intentionally heterogeneous; production code retains the strict rule.
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
];

export default config;
