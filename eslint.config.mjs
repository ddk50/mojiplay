import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'dist-test/**',
      'release/**',
      'out/**',
      'build/**',
      'logs/**',
      'renderer/vendor/**',
    ],
  },
  {
    files: ['**/*.ts'],
    extends: [eslint.configs.recommended, ...tseslint.configs.recommended],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    files: ['src/main.ts', 'src/preload.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    files: [
      'src/core/**/*.ts',
      'src/usecases/**/*.ts',
      'src/repository/**/*.ts',
      'src/controllers/**/*.ts',
      'src/renderer/**/*.ts',
    ],
    languageOptions: {
      globals: {
        ...globals.browser,
        fabric: 'readonly',
        fontkit: 'readonly',
      },
    },
  },
  {
    files: ['test/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.jest,
        ...globals.node,
        ...globals.browser,
        fabric: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  prettierConfig,
);
