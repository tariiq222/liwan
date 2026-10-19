import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins:[vue()],
  test: {
    // Playwright specs live in e2e/ and run via `npm run test:e2e`, not vitest.
    exclude: ['**/node_modules/**', '**/e2e/**'],
  },
})
