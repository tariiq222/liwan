import { defineConfig } from '@playwright/test'
import { DEV_PORT, INSTALLATION_ID, MOCK_PORT, PROD_PORT, SERVICE_KEY } from './e2e/mock-settings.mjs'

// The specs run against the mock control service (e2e/mock-control.mjs) and either the production
// build (`npm run build` first; the default) or `nuxt dev` (E2E_TARGET=dev, for specs that import
// app source). Ports are chosen to stay clear of the other apps: dev 3110, build 3113, mock 4711.
const target = process.env.E2E_TARGET === 'dev' ? 'dev' : 'prod'
const port = target === 'dev' ? DEV_PORT : PROD_PORT
const origin = `http://localhost:${port}`

const bffEnv = {
  NUXT_CONTROL_URL: `http://127.0.0.1:${MOCK_PORT}`,
  NUXT_SERVICE_KEY: SERVICE_KEY,
  NUXT_INSTALLATION_ID: INSTALLATION_ID,
  NUXT_ADMIN_ORIGIN: origin,
  // `nuxt dev` hands requests to its worker through a proxy that carries the address in x-forwarded-for.
  NUXT_TRUST_PROXY: target === 'dev' ? 'true' : 'false',
}

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  // The first page of `nuxt dev` compiles on demand.
  expect: { timeout: target === 'dev' ? 30_000 : 5_000 },
  // One mock service with shared state: run serially.
  workers: 1,
  reporter: 'list',
  projects: [
    { name: 'prod', testIgnore: /(\.dev|live-control)\.spec\.ts$/ },
    { name: 'dev', testMatch: /\.dev\.spec\.ts$/ },
  ].filter(project => project.name === target),
  use: { baseURL: origin, locale: 'ar-SA' },
  webServer: [
    { command: 'node e2e/mock-control.mjs', url: `http://127.0.0.1:${MOCK_PORT}/__mock/stats`, reuseExistingServer: false },
    target === 'dev'
      ? { command: `npx nuxt dev --port ${DEV_PORT}`, url: `${origin}/login`, env: bffEnv, reuseExistingServer: false, timeout: 120_000 }
      : { command: 'node .output/server/index.mjs', url: `${origin}/login`, env: { ...bffEnv, PORT: String(PROD_PORT) }, reuseExistingServer: false },
  ],
})
