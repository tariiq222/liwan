import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  // A stray test.only would make a CI stage run one test and pass.
  forbidOnly: !!process.env.CI,
  // The e2e suites share one Odoo backend; parallel logins are flaky, so run serially.
  workers: 1,
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000', locale: 'ar-SA' },
  reporter: 'list',
})
