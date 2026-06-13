import pluginJs from '@eslint/js'
import eslintConfigPrettier from 'eslint-config-prettier/flat'
import pluginVue from 'eslint-plugin-vue'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    ignores: [
      '.output/**',
      '.wxt/**',
      'node_modules/**',
      'tests/**',
      'coverage/**',
      'coverage-e2e/**',
      'coverage-all/**',
      'test-results/**',
      '.**/**',
    ],
  },
  { files: ['**/*.{js,mjs,cjs,ts,vue}'] },
  { languageOptions: { globals: { ...globals.browser, browser: 'readonly' } } },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/essential'],
  {
    files: ['**/*.vue'],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
  },
  {
    rules: {
      'vue/multi-word-component-names': 'off',
    },
  },
  eslintConfigPrettier,
]
