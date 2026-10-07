import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'
import { configDefaults, defineConfig } from 'vitest/config'

const srcPath = fileURLToPath(new URL('./src', import.meta.url))

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': srcPath,
      '#i18n': fileURLToPath(new URL('./.wxt/i18n/index.ts', import.meta.url)),
      '@wxt-dev/browser': fileURLToPath(
        new URL('./tests/helpers/i18n.ts', import.meta.url),
      ),
      'wxt/browser': fileURLToPath(
        new URL('./tests/helpers/i18n.ts', import.meta.url),
      ),
    },
  },
  test: {
    server: {
      deps: { inline: ['@wxt-dev/i18n', '@wxt-dev/browser'] },
    },
    coverage: {
      provider: 'istanbul',
      include: ['src/**/*.{ts,vue}'],
      reporter: ['text', 'html', 'lcov', 'json'],
    },
    environment: 'node',
    exclude: [...configDefaults.exclude, 'tests/e2e/**'],
    globals: false,
    setupFiles: ['./tests/setup/wxt-auto-imports.ts'],
  },
})
