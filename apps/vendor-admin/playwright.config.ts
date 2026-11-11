import { defineConfig } from '@playwright/test'
import { INSTALLATION_ID, MOCK_PORT, PROD_PORT, SERVICE_KEY } from './e2e/mock-settings.mjs'

// The specs run against the mock control service (e2e/mock-control.mjs) and the production build
// (`npm run build` first). Ports are chosen to stay clear of the other apps: build 3113, mock 4711.
const origin = `http://localhost:${PROD_PORT}`

const bffEnv = {
  NUXT_CONTROL_URL: `http://127.0.0.1:${MOCK_PORT}`,
  NUXT_SERVICE_KEY: SERVICE_KEY,
  NUXT_INSTALLATION_ID: INSTALLATION_ID,
  NUXT_ADMIN_ORIGIN: origin,
  NUXT_TRUST_PROXY: 'false',
}

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  // A stray test.only would make a CI stage run one test and pass.
  forbidOnly: !!process.env.CI,
  expect: { timeout: 5_000 },
  // One mock service with shared state: run serially.
  workers: 1,
  reporter: 'list',
  // live-control.spec.ts drives a real scratch control plane (tools/vendor_admin_local_check.mjs), never this mock.
  projects: [{ name: 'prod', testIgnore: /live-control\.spec\.ts$/ }],
  use: { baseURL: origin, locale: 'ar-SA' },
  webServer: [
    { command: 'node e2e/mock-control.mjs', url: `http://127.0.0.1:${MOCK_PORT}/__mock/stats`, reuseExistingServer: false },
    { command: 'node .output/server/index.mjs', url: `${origin}/login`, env: { ...bffEnv, PORT: String(PROD_PORT) }, reuseExistingServer: false },
  ],
})
