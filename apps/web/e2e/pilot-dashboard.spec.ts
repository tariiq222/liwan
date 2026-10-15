import { expect, test, type Page } from '@playwright/test'

// Plan 5 pilot: /projects/dashboard on SharedDashboardPage + SharedChartPanel (isolated mock stack).
// The mock analytics call returns three projects, so the six panels and the recent-projects card render.
const ADMIN_LOGIN = process.env.E2E_ADMIN_LOGIN ?? 'admin'
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'admin'
const PANELS = ['chart-status', 'chart-tasks', 'chart-progress-bands', 'chart-budget-health', 'chart-project-progress', 'chart-project-finance']
async function login(page: Page) {
  const response = await page.request.post('/api/auth/login', { data: { login: ADMIN_LOGIN, password: ADMIN_PASSWORD } })
  expect(response.status()).toBe(200)
}
async function open(page: Page, path = '/projects/dashboard') {
  await page.goto(path)
  await expect(page.getByTestId('global-search-trigger')).toBeEnabled()
}
// The server renders the first load and fetches the analytics itself, so a browser route cannot intercept it:
// open another page first and move to the dashboard client-side, where the browser makes the request.
// Relies on the dev-only window.useNuxtApp, so it runs only against `nuxt dev`.
async function openClientSide(page: Page, path: string) {
  await open(page, '/projects')
  await page.evaluate(target => (window as unknown as { useNuxtApp: () => { $router: { push: (to: string) => Promise<unknown> } } }).useNuxtApp().$router.push(target), path)
}
const fitsWidth = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

test.describe('Plan 5 pilot: the project dashboard', () => {
  test.beforeEach(async ({ page }) => { await login(page) })

  test.describe('desktop', () => {
    test.use({ viewport: { width: 1440, height: 900 } })

    test('the dashboard template holds the filters, four metric tiles, six chart panels and the recent projects', async ({ page }) => {
      await open(page)
      await expect(page.getByTestId('project-dashboard-page')).toBeVisible()
      await expect(page.locator('[data-template="dashboard-page"]')).toHaveCount(1)
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('نظرة عامة')
      await expect(page.locator('[data-template="dashboard-filters"]')).toBeVisible()
      await expect(page.getByTestId('project-dashboard-status-filter')).toBeAttached()
      await expect(page.locator('[data-template="dashboard-metrics"] [data-testid="metric-tile"]')).toHaveCount(4)
      for (const id of PANELS) await expect(page.getByTestId(id)).toBeVisible()
      await expect(page.locator('[data-template="chart-panel"]')).toHaveCount(6)
      for (const name of ['حالات المشاريع', 'تركيبة المهام', 'نطاقات التقدم', 'صحة الميزانيات', 'التقدم حسب المشروع', 'المخطط مقابل الفعلي']) await expect(page.getByRole('region', { name, exact: true })).toBeVisible()
      await expect(page.getByTestId('recent-project-row')).toHaveCount(3)
      await expect(page.getByTestId('chart-canvas').first()).toBeVisible()
    })

    test('charts sit two-up and the wide ones span both columns', async ({ page }) => {
      await open(page)
      const box = async (id: string) => (await page.getByTestId(id).boundingBox())!
      const [status, tasks, wide, finance] = [await box('chart-status'), await box('chart-tasks'), await box('chart-project-progress'), await box('chart-project-finance')]
      expect(status.y).toBeCloseTo(tasks.y, 0)
      expect(wide.width).toBeGreaterThan(status.width + tasks.width)
      expect(finance.width).toBeGreaterThan(status.width + tasks.width)
    })

    test('analytics failure and an empty result keep their blocks, and the failure retries', async ({ page }) => {
      let unavailable = true
      await page.route('**/api/v1/reports/projects/analytics*', route => unavailable
        ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'unavailable', message: 'Test unavailable' }) })
        : route.continue())
      await openClientSide(page, '/projects/dashboard')
      const failure = page.getByTestId('project-dashboard-analytics-error')
      await expect(failure).toBeVisible({ timeout: 15_000 })
      await expect(page.getByTestId('chart-canvas')).toHaveCount(0)
      unavailable = false
      await failure.getByRole('button', { name: 'إعادة المحاولة', exact: true }).click()
      await expect(page.getByTestId('chart-status')).toBeVisible()
      await page.unroute('**/api/v1/reports/projects/analytics*')
      await page.route('**/api/v1/reports/projects/analytics*', async route => {
        const response = await route.fetch()
        const body = await response.json()
        await route.fulfill({ response, json: { ...body, project_count: 0, projects: [], recent_projects: [], status_counts: [] } })
      })
      await openClientSide(page, '/projects/dashboard?q=does-not-exist')
      await expect(page.getByTestId('project-dashboard-empty')).toBeVisible()
      await expect(page.getByTestId('recent-project-row')).toHaveCount(0)
      await expect(page.locator('[data-template="chart-panel"]')).toHaveCount(0)
    })

    test('a filter lands in the URL and survives a reload', async ({ page }) => {
      await open(page)
      await page.getByRole('button', { name: 'البحث والفلاتر', exact: true }).click()
      await page.getByTestId('project-dashboard-status-filter').getByRole('button', { name: 'خارج المسار', exact: true }).click()
      await expect(page).toHaveURL(/status=off_track/)
      await page.reload()
      await expect(page.getByTestId('global-search-trigger')).toBeEnabled()
      await expect(page).toHaveURL(/status=off_track/)
      await expect(page.getByTestId('project-dashboard-page')).toBeVisible()
    })
  })

  test.describe('phone', () => {
    test.use({ viewport: { width: 390, height: 844 } })

    test('on a 390px phone the panels stack and nothing overflows', async ({ page }) => {
      await open(page)
      for (const id of PANELS) await expect(page.getByTestId(id)).toBeVisible()
      const status = (await page.getByTestId('chart-status').boundingBox())!
      const tasks = (await page.getByTestId('chart-tasks').boundingBox())!
      expect(tasks.y).toBeGreaterThan(status.y + status.height - 1)
      expect(await fitsWidth(page)).toBe(true)
    })
  })
})
