import { expect, test, type Page } from '@playwright/test'

test.skip(process.env.E2E_BASE_URL !== 'http://127.0.0.1:3985', 'Requires isolated project-charts fixture on 3985.')
async function login(page: Page) {
  await page.goto('/login')
  await expect(page.getByRole('button', { name: 'دخول', exact: true })).toBeEnabled()
  await page.getByLabel('اسم المستخدم').fill('chart_manager')
  await page.getByLabel('كلمة المرور').fill('chart_test_only_2026')
  await page.getByRole('button', { name: 'دخول', exact: true }).click()
  await expect(page).not.toHaveURL(/\/login/)
}
async function charts(page: Page) {
  await expect(page.getByTestId('chart-canvas')).toHaveCount(6)
  for (const chart of await page.getByTestId('chart-canvas').all()) {
    await expect(chart.locator('svg')).toBeVisible()
    expect(await chart.locator('svg path').count()).toBeGreaterThan(0)
  }
}
for (const width of [390, 768, 1440]) {
  test(`six charts and five latest projects at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 })
    await login(page)
    await page.getByTestId('module-rail').getByRole('link', { name: 'نظرة عامة', exact: true }).click()
    await expect(page).toHaveURL(/\/projects\/dashboard$/)
    await expect(page.getByTestId('application-navigation').getByRole('heading', { name: 'المشاريع', level: 2 })).toBeVisible()
    await expect(page.getByTestId('application-navigation').locator('.liwan-sub-list .liwan-quick-link')).toHaveText(['نظرة عامة', 'عرض الكل', 'مهامي'])
    await expect(page.getByTestId('context-link-new-project')).toBeVisible()
    await expect(page.getByTestId('context-link-project-dashboard')).toHaveAttribute('aria-current', 'page')
    await charts(page)
    const response = await page.request.get('/api/v1/reports/projects/analytics')
    expect(response.status()).toBe(200)
    const analytics = await response.json()
    expect(analytics.project_count).toBe(12)
    expect(analytics.projects).toHaveLength(12)
    expect(analytics.recent_projects.map((row: { project: { name: string } }) => row.project.name)).toEqual([
      'مبادرة الاستدامة', 'اعتماد الجودة المؤسسية', 'تطوير الخدمات المساندة', 'برنامج الشراكات', 'قياس تجربة المستفيد',
    ])
    const rows = page.getByTestId(width < 768 ? 'recent-project-card' : 'recent-project-row')
    await expect(rows).toHaveCount(5)
    for (let index = 0; index < 5; index++) await expect(rows.nth(index)).toContainText(analytics.recent_projects[index].project.name)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`charts-${width}.png`), fullPage: true })
    await rows.first().getByRole('link').first().click()
    await expect(page).toHaveURL(new RegExp(`/projects/${analytics.recent_projects[0].project.id}`))
    await page.goBack()
    await expect(rows).toHaveCount(5)
    await page.getByTestId('context-link-projects').click()
    await expect(page).toHaveURL(/\/projects$/)
    await page.goto('/projects?mine=1')
    await expect(page).toHaveURL(/\/projects\?mine=1$/)
    expect((await (await page.request.get('/api/v1/projects?mine=1')).json()).total).toBe(10)
  })
}
test('legacy filters survive redirect and reload with honest empty state', async ({ page }) => {
  await login(page)
  await page.goto('/reports?q=does-not-exist&status=off_track')
  await expect(page).toHaveURL(/\/projects\/dashboard\?q=does-not-exist&status=off_track$/)
  await expect(page.getByTestId('project-dashboard-empty')).toBeVisible()
  await expect(page.getByTestId('recent-project-row')).toHaveCount(0)
  await page.reload()
  await expect(page.getByTestId('project-dashboard-empty')).toBeVisible()
})
test('analytics failure shows retry without stale charts', async ({ page }) => {
  await login(page)
  let unavailable = true
  await page.route('**/api/v1/reports/projects/analytics*', route => unavailable
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'unavailable', message: 'Test unavailable' }) })
    : route.continue())
  await page.goto('/projects/dashboard')
  await expect(page.getByTestId('project-dashboard-analytics-error')).toBeVisible({ timeout: 15000 })
  await expect(page.getByTestId('chart-canvas')).toHaveCount(0)
  unavailable = false
  await page.getByTestId('project-dashboard-analytics-error').getByRole('button', { name: 'إعادة المحاولة', exact: true }).click()
  await charts(page)
})
for (const mode of ['dark', 'light'] as const) {
  test(`${mode} and large type on mobile`, async ({ page }, info) => {
    await page.setViewportSize({ width: 390, height: 1000 })
    await login(page)
    await page.context().addCookies([{ name: 'liwan-appearance', value: encodeURIComponent(JSON.stringify({ mode, fontSize: 'large' })), url: new URL(page.url()).origin }])
    await page.goto('/projects/dashboard')
    await expect(page.locator('html')).toHaveAttribute('data-font-size', 'large')
    await charts(page)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`charts-${mode}-large-mobile.png`), fullPage: true })
  })
}

test('chart labels recover after narrowing and widening the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await login(page)
  await page.goto('/projects/dashboard')
  await charts(page)
  const label = page.getByTestId('chart-project-progress').locator('svg text').filter({ hasText: /^أتمتة خدمات المستفيدين$/ })
  await expect(label).toBeVisible()
  await page.setViewportSize({ width: 390, height: 1000 })
  await expect(label).toHaveCount(0)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await expect(label).toBeVisible()
})
