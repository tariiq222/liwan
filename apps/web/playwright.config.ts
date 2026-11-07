import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  // The e2e suites share one Odoo backend; parallel logins are flaky, so run serially.
  workers: 1,
  // The real-Odoo journeys wait on a server push (the chat thread) and on a production build's first paint;
  // on a loaded runner such a wait occasionally misses its deadline. One retry separates that timing miss from
  // a genuine failure only there: the mock suite, which has no cross-process wait, stays strict with no retries.
  retries: process.env.E2E_REAL_ODOO === '1' ? 1 : 0,
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000', locale: 'ar-SA' },
  reporter: 'list',
})
