import { defineConfig } from '@playwright/test'

// RTL smoke over the built Storybook (npm run test:rtl). No Odoo or Nuxt server needed:
// the static build is served locally. `*.rtl.ts` keeps vitest and the default Playwright
// project from picking these files up.
const port = process.env.STORYBOOK_RTL_PORT ?? '6007'

export default defineConfig({
  testDir: './e2e-rtl',
  testMatch: '**/*.rtl.ts',
  timeout: 30_000,
  workers: 4,
  reporter: 'list',
  use: { baseURL: `http://127.0.0.1:${port}`, locale: 'ar-SA' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: `node e2e-rtl/serve.mjs storybook-static ${port}`,
    url: `http://127.0.0.1:${port}/index.json`,
    reuseExistingServer: true,
    timeout: 30_000,
  },
})
