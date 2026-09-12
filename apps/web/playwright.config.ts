import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  // These four are migration-era specs bound to another environment: they read
  // a fixtures file from /Users/tariq/code/nasq-nuxt-migration-artifacts and
  // assert baseURL http://127.0.0.1:3469. Because they read that file at module
  // level, a missing artifacts directory aborted COLLECTION for the entire
  // suite — so no e2e spec could run here at all. Ignoring them by default
  // restores the suite; run them explicitly with the artifacts present.
  testIgnore: [
    'nuxt-all-pages.spec.ts',
    'nuxt-module-controls.spec.ts',
    'nuxt-hydration-diagnostic.spec.ts',
    'nuxt-project-workflows.spec.ts',
  ],
  timeout: 30_000,
  // The e2e suites share one Odoo backend; parallel logins are flaky, so run serially.
  workers: 1,
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000', locale: 'ar-SA' },
  reporter: 'list',
})
