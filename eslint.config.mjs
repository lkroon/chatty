// Shared stock ESLint flat config for apps/api, apps/web and libs/contracts.
// Intentionally minimal — one custom rule: no-unused-vars with ignoreRestSiblings
// to allow rest-sibling destructuring. Each app's package.json "lint"
// script invokes eslint from its own directory; ESLint's flat-config
// discovery walks up to find this file.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.angular/**',
      '**/coverage/**',
      '**/public/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { ignoreRestSiblings: true },
      ],
    },
  },
  eslintConfigPrettier,
);
