import { defineConfig } from 'vitest/config'

// The packages acceptance suite needs a scratch Odoo tenant no CI stage provisions;
// it runs on demand with `npm -w apps/control-plane run test:packages-acceptance`.
export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/packages-acceptance.live.test.ts'],
  },
})
