// Playwright config for the live acceptance browser proof (proof 8).
//
// The shared harness lives outside apps/web, so apps/web's own playwright.config
// (testDir: './e2e') never discovers it. This config keeps the proof where it is
// and gives it its own discovery root.
//
// Run from the repository root:
//   cd apps/web && npx playwright test --config ../tools/shared_acceptance_live/playwright.config.mjs
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: ['proof8.spec.mjs'],
  timeout: 240_000,
  // One tenant at a time: the A and B contexts must not interleave logins.
  workers: 1,
  reporter: 'list',
  // Keep run artifacts out of the repository root.
  outputDir: '/tmp/nasq-accept-logs/playwright-output',
  use: { locale: 'ar-SA' },
})
