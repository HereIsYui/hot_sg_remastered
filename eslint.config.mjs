import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import vue from 'eslint-plugin-vue';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      'legacy/**',
      'apps/client/public/assets/**',
      'apps/server/src/db/schema.generated.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: { parser: tseslint.parser },
    },
    rules: {
      'vue/require-default-prop': 'off',
    },
  },
  {
    files: ['apps/client/**', 'apps/gm/**'],
    languageOptions: { globals: globals.browser },
  },
  {
    // Server and game HTML only reaches v-html through flexHtml(), which whitelists Flex tags.
    files: ['apps/client/**/*.vue'],
    rules: { 'vue/no-v-html': 'off' },
  },
  {
    files: ['apps/server/**', 'tools/**', 'packages/**', '*.mjs'],
    languageOptions: { globals: globals.node },
  },
  prettier,
);
