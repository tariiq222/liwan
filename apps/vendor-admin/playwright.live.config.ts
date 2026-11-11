import { defineConfig } from '@playwright/test'

// The live proof against the REAL control plane. It is started and stopped by
// `node tools/vendor_admin_local_check.mjs` (repository root), which exports the LIVE_* values; there is
// no webServer here and this config is never part of `npm run e2e`, `npm test` or CI.
export default defineConfig({
  testDir: './e2e',
  testMatch: /live-control\.spec\.ts$/,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: process.env.LIVE_JSON_REPORT ? [['list'], ['json', { outputFile: process.env.LIVE_JSON_REPORT }]] : 'list',
  use: { baseURL: process.env.LIVE_ADMIN_ORIGIN, locale: 'ar-SA' },
})
