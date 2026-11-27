import { defineConfig } from 'vitest/config'

// The plans acceptance suite needs a scratch Odoo tenant no CI stage provisions;
// it runs on demand with `npm -w apps/control-plane run test:plans-acceptance`.
export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/plans-acceptance.live.test.ts'],
  },
})
