import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import vue from 'eslint-plugin-vue';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/coverage/**', 'legacy/**', 'apps/client/public/assets/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: { parser: tseslint.parser },
    },
  },
  {
    files: ['apps/client/**', 'apps/gm/**'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['apps/server/**', 'tools/**', 'packages/**', '*.mjs'],
    languageOptions: { globals: globals.node },
  },
  prettier,
);
