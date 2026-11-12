import { defineConfig } from '@playwright/test'

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  // A stray test.only would make a CI stage run one test and pass.
  forbidOnly: !!process.env.CI,
  // The e2e suites share one Odoo backend; parallel logins are flaky, so run serially.
  workers: 1,
  // The /api/v1 proxy refuses a write that is not same-origin (AUDIT-023). A browser marks its own requests;
  // `page.request` and API contexts send no fetch metadata, so they carry the Origin a browser page would.
  use: { baseURL, locale: 'ar-SA', extraHTTPHeaders: { origin: new URL(baseURL).origin } },
  reporter: 'list',
})
