import { expect, test, type Page } from '@playwright/test'

test.describe.configure({ timeout: 30_000 })
test.skip(
  process.env.E2E_BASE_URL !== 'http://127.0.0.1:4597',
  'Run against the isolated internal-ui-audit mock server, never the canonical app port.',
)

async function login(page: Page) {
  await page.goto('/login')
  await page.getByLabel('اسم المستخدم').fill('admin')
  await page.getByLabel('كلمة المرور').fill('admin')
  await page.getByRole('button', { name: 'دخول', exact: true }).click()
  await expect(page).toHaveURL(/\/tasks$/)
}

function reportResponse(offset: number, total: number, count = Math.min(50, Math.max(0, total - offset))) {
  const currency = { id: 1, name: 'SAR', symbol: 'ر.س', decimal_places: 2 }
  const items = Array.from({ length: count }, (_, index) => {
    const id = offset + index + 1
    return {
      project: { id, name: `تقرير ${id}`, status: 'on_track' },
      finance: {
        project_id: id,
        currency,
        charter_estimate: null,
        planned: 1000,
        actual: 300,
        remaining: 700,
        utilization_percent: 30,
        over_budget: false,
        budget_count: 1,
        expense_count: 1,
      },
      task_count: 2,
      closed_task_count: 1,
      overdue_task_count: 0,
      progress: 50,
    }
  })
  return {
    items,
    total,
    totals: [{
      currency,
      project_count: total,
      budgeted_project_count: total,
      planned: total * 1000,
      actual: total * 300,
      remaining: total * 700,
      over_budget_count: 0,
    }],
  }
}

test('reports is a canonical project view with shared route filters and safe API queries', async ({ page }) => {
  const reportRequests: URL[] = []
  page.on('request', request => {
    const url = new URL(request.url())
    if (url.pathname === '/api/v1/reports/projects') reportRequests.push(url)
  })

  await login(page)
  await page.route('**/api/v1/reports/projects**', async route => {
    const requestUrl = new URL(route.request().url())
    const offset = Number(requestUrl.searchParams.get('offset') || '0')
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reportResponse(offset, 101)) })
  })
  await page.goto('/projects?q=portal&status=on_track')
  await expect(page.getByRole('heading', { name: 'المشاريع', level: 1 })).toBeVisible()
  await page.getByTestId('projects-view-reports').click()
  await expect(page.getByTestId('reports-row').first()).toBeVisible()
  await expect(page.getByTestId('projects-view-reports')).toContainText('تقارير')
  await expect(page.getByTestId('projects-view-reports')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('projects-view-table')).toContainText('جدول')
  await expect(page.getByTestId('projects-view-cards')).toContainText('بطاقات')

  await expect.poll(() => reportRequests.at(-1)?.searchParams.get('q')).toBe('portal')
  const reportQuery = reportRequests.at(-1)!
  expect(reportQuery.searchParams.get('status')).toBe('on_track')
  expect(reportQuery.searchParams.get('offset')).toBe('0')
  expect(reportQuery.searchParams.has('archived')).toBe(false)
  expect(reportQuery.searchParams.has('sort')).toBe(false)

  await page.getByRole('button', { name: 'التالي' }).click()
  await expect(page).toHaveURL((url) => url.searchParams.get('view') === 'reports' && url.searchParams.get('offset') === '50')
  await expect(page.getByText('صفحة 2 من 3')).toBeVisible()
  await expect.poll(() => reportRequests.at(-1)?.searchParams.get('offset')).toBe('50')

  const reportListPath = new URL(page.url()).pathname + new URL(page.url()).search
  await page.getByTestId('project-new').click()
  await expect(page).toHaveURL(/\/projects\/new\?returnTo=/)
  expect(new URL(page.url()).searchParams.get('returnTo')).toBe(reportListPath)

  const legacyRedirect = await page.request.get('/reports?q=portal&status=on_track&offset=50', { maxRedirects: 0 })
  expect(legacyRedirect.status()).toBeGreaterThanOrEqual(300)
  expect(legacyRedirect.status()).toBeLessThan(400)
  expect(legacyRedirect.headers().location).toContain('/projects?view=reports')

  await page.goto('/reports?q=portal&status=on_track')
  await expect(page).toHaveURL((url) => (
    url.pathname === '/projects'
    && url.searchParams.get('view') === 'reports'
    && url.searchParams.get('q') === 'portal'
    && url.searchParams.get('status') === 'on_track'
    && url.searchParams.get('offset') === null
  ))
  await expect(page.getByTestId('reports-row').first()).toBeVisible()

  const requestsBeforeCards = reportRequests.length
  await page.getByTestId('projects-view-cards').click()
  await expect(page).toHaveURL((url) => url.pathname === '/projects' && url.searchParams.get('view') === 'cards' && !url.searchParams.has('offset'))
  await expect(page.getByTestId('project-card').first()).toBeVisible()
  await expect(page.getByTestId('project-new')).toBeVisible()
  expect(reportRequests.length).toBe(requestsBeforeCards)
  await page.reload()
  await expect(page.getByTestId('projects-view-cards')).toHaveAttribute('aria-pressed', 'true')
  await page.getByTestId('projects-view-table').click()
  await expect(page.getByTestId('projects-view-table')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('project-new')).toBeVisible()
  await page.getByTestId('projects-view-reports').click()
  await expect(page.getByTestId('projects-view-reports')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('project-new')).toBeVisible()
})

test('reports hides project creation when the server envelope denies it', async ({ page }) => {
  await login(page)
  let denied = false
  await page.route('**/api/v1/projects**', async route => {
    const requestUrl = new URL(route.request().url())
    if (route.request().method() !== 'GET' || requestUrl.pathname !== '/api/v1/projects') {
      await route.continue()
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [],
        total: 0,
        can_create: !denied,
        can_list_archived: false,
      }),
    })
  })

  await page.goto('/projects')
  await expect(page.getByTestId('project-new')).toBeVisible()
  denied = true
  await page.getByPlaceholder('ابحث باسم المشروع…').fill('permission-refresh')
  await expect(page).toHaveURL(/q=permission-refresh/)
  await expect(page.getByTestId('project-new')).toHaveCount(0)
  await page.getByTestId('projects-view-reports').click()
  await expect(page.getByTestId('reports-page')).toBeVisible()
  await expect(page.getByTestId('project-new')).toHaveCount(0)
})

test('search is flushed before create, and create cancel/save preserve the report context', async ({ page }) => {
  await login(page)
  const detail = await (await page.request.get('/api/v1/projects/1')).json()
  await page.route('**/api/v1/projects**', async route => {
    const requestUrl = new URL(route.request().url())
    if (requestUrl.pathname === '/api/v1/projects' && route.request().method() === 'POST') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...detail, id: 99, name: 'مشروع محفوظ' }) })
      return
    }
    if (requestUrl.pathname === '/api/v1/projects/99' && route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...detail, id: 99, name: 'مشروع محفوظ' }) })
      return
    }
    await route.continue()
  })

  await page.goto('/projects?view=reports&status=on_track')
  await page.getByPlaceholder('ابحث باسم المشروع…').fill('rapid')
  await page.getByTestId('project-new').click()
  await expect(page).toHaveURL(/\/projects\/new\?returnTo=/)
  const rapidReturn = new URL(page.url()).searchParams.get('returnTo')
  expect(rapidReturn).toContain('view=reports')
  expect(rapidReturn).toContain('q=rapid')
  await page.getByRole('button', { name: 'إلغاء', exact: true }).click()
  await expect(page).toHaveURL((url) => url.pathname === '/projects' && url.searchParams.get('view') === 'reports' && url.searchParams.get('q') === 'rapid')

  await page.getByTestId('projects-view-table').click()
  await expect(page).toHaveURL((url) => !url.searchParams.has('view') && url.searchParams.get('q') === 'rapid')
  await page.getByTestId('projects-view-reports').click()
  await expect(page).toHaveURL((url) => url.searchParams.get('view') === 'reports' && url.searchParams.get('q') === 'rapid')
  await page.getByTestId('project-new').click()
  await expect(page).toHaveURL(/\/projects\/new\?returnTo=/)
  const saveReturn = new URL(page.url()).searchParams.get('returnTo')
  await page.getByTestId('project-create-name').fill('مشروع محفوظ')
  await page.getByTestId('project-create-submit').click()
  await expect(page).toHaveURL(/\/projects\/99\?returnTo=/)
  expect(new URL(page.url()).searchParams.get('returnTo')).toBe(saveReturn)
})

test('unified views keep mobile overflow contained and support English dark appearance', async ({ page, context }) => {
  await context.addCookies([
    { name: 'nasq-appearance', value: JSON.stringify({ mode: 'dark', fontSize: 'medium' }), url: 'http://127.0.0.1:4597' },
  ])
  await login(page)
  const setEnglish = () => page.evaluate(async () => {
    const root = document.querySelector('#__nuxt') as HTMLElement & {
      __vue_app__?: { config?: { globalProperties?: { $nuxt?: { $i18n?: { setLocale: (code: string) => Promise<void> } } } } }
    }
    const nuxt = root?.__vue_app__?.config?.globalProperties?.$nuxt
    if (!nuxt?.$i18n) throw new Error('Nuxt i18n runtime is unavailable')
    await nuxt.$i18n.setLocale('en')
  })
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/projects?view=reports')
    await expect(page.getByTestId('projects-view-reports')).toBeEnabled()
    await setEnglish()
    await expect(page.getByTestId('projects-view-reports')).toContainText('Reports')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(1)
  }
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
  await expect(page.locator('html')).toHaveClass(/dark/)
})

test('reports preserves error recovery, empty state, and pagination in the shared page', async ({ page }) => {
  let failing = true
  const requests: URL[] = []
  await login(page)
  await page.goto('/projects')
  await page.route('**/api/v1/reports/projects**', async route => {
    const requestUrl = new URL(route.request().url())
    requests.push(requestUrl)
    if (failing) {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'server_error', message: 'temporary' }) })
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], total: 0, totals: [] }) })
  })

  await page.getByTestId('projects-view-reports').click()
  await expect(page.getByRole('alert')).toBeVisible()
  failing = false
  await page.getByRole('alert').getByRole('button', { name: 'إعادة المحاولة' }).click()
  await expect(page.getByText('لا تقارير مشاريع بعد')).toBeVisible()
  expect(requests.length).toBeGreaterThanOrEqual(2)

  await page.unroute('**/api/v1/reports/projects**')
  await page.route('**/api/v1/reports/projects**', async route => {
    const requestUrl = new URL(route.request().url())
    const offset = Number(requestUrl.searchParams.get('offset') || '0')
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reportResponse(offset, 101)) })
  })
  await page.getByTestId('projects-view-cards').click()
  await expect(page.getByTestId('projects-view-cards')).toHaveAttribute('aria-pressed', 'true')
  await page.getByTestId('projects-view-reports').click()
  await expect(page.getByTestId('projects-view-reports')).toHaveAttribute('aria-pressed', 'true')
  await page.getByPlaceholder('ابحث باسم المشروع…').fill('pagination')
  await expect(page).toHaveURL(/q=pagination/)
  await expect(page.getByText('صفحة 1 من 3')).toBeVisible()
  await page.getByRole('button', { name: 'التالي' }).click()
  await expect(page).toHaveURL((url) => url.searchParams.get('view') === 'reports' && url.searchParams.get('offset') === '50')
  await expect(page.getByText('صفحة 2 من 3')).toBeVisible()
})

test('creation capability keeps the newest page denial across the reports cache boundary', async ({ page }) => {
  let denyPageTwo = false
  let failProbe = false
  await login(page)
  await page.route('**/api/v1/projects**', async route => {
    const requestUrl = new URL(route.request().url())
    if (route.request().method() !== 'GET' || requestUrl.pathname !== '/api/v1/projects') {
      await route.continue()
      return
    }
    const limit = requestUrl.searchParams.get('limit')
    if (limit === '1' && failProbe) {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'server_error', message: 'temporary' }) })
      return
    }
    const response = await route.fetch()
    const payload = await response.json() as Record<string, unknown>
    const offset = Number(requestUrl.searchParams.get('offset') || '0')
    await route.fulfill({
      response,
      body: JSON.stringify({
        ...payload,
        total: 101,
        can_create: limit === '1' ? true : !(denyPageTwo && offset === 50),
      }),
    })
  })

  await page.goto('/projects')
  await expect(page.getByTestId('project-new')).toBeVisible()
  denyPageTwo = true
  await page.getByRole('button', { name: 'التالي' }).click()
  await expect(page).toHaveURL(/offset=50/)
  await expect(page.getByTestId('project-new')).toHaveCount(0)
  await page.getByTestId('projects-view-reports').click()
  await expect(page.getByTestId('reports-page')).toBeVisible()
  await expect(page.getByTestId('project-new')).toHaveCount(0)

  await page.getByTestId('projects-view-table').click()
  await page.getByPlaceholder('ابحث باسم المشروع…').fill('capability-restore')
  await expect(page).toHaveURL(/q=capability-restore/)
  await expect(page.getByTestId('project-new')).toBeVisible()

  await page.waitForTimeout(5_100)
  failProbe = true
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'))
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByTestId('project-new')).toHaveCount(0)
  failProbe = false
  await page.getByRole('alert').getByRole('button', { name: 'إعادة المحاولة' }).click()
  await expect(page.getByTestId('project-new')).toBeVisible()
})
