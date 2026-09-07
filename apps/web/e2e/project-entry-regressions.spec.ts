import { expect, test, type Page } from '@playwright/test'

test.describe.configure({ timeout: 30_000 })
test.skip(
  process.env.E2E_BASE_URL !== 'http://127.0.0.1:3983',
  'Run against the isolated project dashboard scratch server, never the canonical app port.',
)

async function login(page: Page, user = 'dashboard_manager') {
  await page.goto('/login')
  await expect(page.getByRole('button', { name: 'دخول', exact: true })).toBeEnabled()
  await page.getByLabel('اسم المستخدم').fill(user)
  await page.getByLabel('كلمة المرور').fill('dashboard_test_only_2026')
  await page.getByRole('button', { name: 'دخول', exact: true }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

function projectListEnvelope(canCreate: boolean) {
  return {
    items: [],
    total: 0,
    can_create: canCreate,
    can_list_archived: false,
  }
}

test('a newer denial stays authoritative when returning to a cached project page', async ({ page }) => {
  let denialResponseSeen = false
  await login(page)
  await page.route('**/api/v1/projects**', async (route) => {
    const requestUrl = new URL(route.request().url())
    if (requestUrl.pathname !== '/api/v1/projects' || route.request().method() !== 'GET') {
      await route.continue()
      return
    }

    const q = requestUrl.searchParams.get('q')
    if (q === 'denied') {
      denialResponseSeen = true
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(projectListEnvelope(false)),
      })
      return
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(projectListEnvelope(true)),
    })
  })

  await page.goto('/projects')
  await expect(page.getByTestId('project-new')).toBeVisible()

  const search = page.getByPlaceholder('ابحث باسم المشروع…')
  await search.fill('denied')
  await expect(page).toHaveURL(/q=denied/)
  await expect.poll(() => denialResponseSeen).toBe(true)
  await expect(page.getByTestId('project-new')).toHaveCount(0)

  // Switching back serves the previously authorized page from the fresh
  // query cache. Its older can_create=true result must not override the
  // newer denial observed for the other query key.
  await search.fill('')
  await expect(page).toHaveURL(/\/projects$/)
  await expect(page.getByTestId('project-new')).toHaveCount(0)
})

test('the project capability probe exposes retry and recovers after a load error', async ({ page }) => {
  let probeReady = false

  await login(page)
  await page.route('**/api/v1/projects**', async (route) => {
    const requestUrl = new URL(route.request().url())
    if (requestUrl.pathname !== '/api/v1/projects' || route.request().method() !== 'GET') {
      await route.continue()
      return
    }
    if (requestUrl.searchParams.get('limit') === '1' && !probeReady) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'unavailable', message: 'Test unavailable' }),
      })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(projectListEnvelope(true)),
    })
  })

  await page.goto('/projects')
  const alert = page.getByRole('alert')
  await expect(alert).toContainText('تعذر تحميل بيانات المشروع')
  await expect(alert.getByRole('button', { name: 'إعادة المحاولة', exact: true })).toBeVisible()
  probeReady = true
  await alert.getByRole('button', { name: 'إعادة المحاولة', exact: true }).click()
  await expect(alert).toHaveCount(0)
  await expect(page.getByTestId('project-new')).toBeVisible()
})

test('immediate search to create and back preserves mine, search, sort, and view', async ({ page }) => {
  await login(page)
  await page.goto('/projects?mine=1&sort=name&view=cards')
  await expect(page.getByTestId('project-new')).toBeVisible()

  await page.getByPlaceholder('ابحث باسم المشروع…').fill('immediate-return')
  await page.getByTestId('project-new').click()
  await expect(page).toHaveURL(/\/projects\/new\?returnTo=/)

  const returnTo = new URL(page.url()).searchParams.get('returnTo')
  expect(returnTo).not.toBeNull()
  const returnUrl = new URL(returnTo!, page.url())
  expect(returnUrl.pathname).toBe('/projects')
  expect(returnUrl.searchParams.get('mine')).toBe('1')
  expect(returnUrl.searchParams.get('q')).toBe('immediate-return')
  expect(returnUrl.searchParams.get('sort')).toBe('name')
  expect(returnUrl.searchParams.get('view')).toBe('cards')

  await page.getByRole('button', { name: 'إلغاء', exact: true }).click()
  await expect(page).toHaveURL((url) => (
    url.pathname === '/projects'
    && url.searchParams.get('mine') === '1'
    && url.searchParams.get('q') === 'immediate-return'
    && url.searchParams.get('sort') === 'name'
    && url.searchParams.get('view') === 'cards'
  ))
})
