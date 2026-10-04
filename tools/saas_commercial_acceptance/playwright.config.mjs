import { defineConfig } from '@playwright/test'
// Public URLs are portless (guard requires a port-free Host); Chromium maps every
// commercial hostname to the loopback edge listener on 8443.
export default defineConfig({
  testDir: '.', testMatch: ['first-tenant.spec.mjs', 'commercial-*.spec.mjs'], workers: 1,
  timeout: 600_000, expect: { timeout: 20_000 }, reporter: 'list',
  outputDir: './test-results',
  use: { baseURL: 'https://vendor.saas.commercial.nasq.test', actionTimeout: 20_000, navigationTimeout: 30_000,
    locale: 'ar-SA', ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 },
    launchOptions: { args: ['--host-resolver-rules=MAP *.saas.commercial.nasq.test 127.0.0.1:8443'] },
  },
})
