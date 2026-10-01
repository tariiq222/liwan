import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: '.', testMatch: ['first-tenant.spec.mjs'], workers: 1,
  timeout: 600_000, expect: { timeout: 20_000 }, reporter: 'list',
  outputDir: './test-results',
  use: { actionTimeout: 20_000, navigationTimeout: 30_000, locale: 'ar-SA', ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 },
    launchOptions: { args: ['--host-resolver-rules=MAP *.saas.accept.nasq.test 127.0.0.1'] },
  },
})
