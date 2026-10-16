import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Playwright specs live in e2e/ and run through their own config.
    exclude: ['**/node_modules/**', '**/e2e/**', '**/.output/**'],
  },
})
