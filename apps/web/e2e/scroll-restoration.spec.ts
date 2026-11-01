import { test, expect, type Page } from '@playwright/test'

// Runs against the mock API with MOCK_TASK_COUNT=60, which is what makes
// /tasks taller than a viewport:
//   cd apps/web && PROJECTS_UI_PREVIEW=1 MODULE_UI_PREVIEW=1 MOCK_PORT=4512 \
//     MOCK_TASK_COUNT=60 node e2e/internal-ui-audit-mock.mjs
//   cd apps/web && NUXT_ODOO_URL=http://127.0.0.1:4512 \
//     NUXT_ODOO_DB=liwan_ui_mock_only NUXT_PUBLIC_WS_URL=ws://127.0.0.1:4512/websocket \
//     npx nuxt dev --port 4111
//   E2E_BASE_URL=http://localhost:4111 npx playwright test e2e/scroll-restoration.spec.ts
// CI runs it on that second stack: see ci-mock-long-list-specs.txt and deploy/ci/e2e-mock.sh.

const LEAVE_AT = 2000

async function login(page: Page) {
  await page.goto('/login')
  await page.getByLabel('اسم المستخدم').fill('admin')
  await page.getByLabel('كلمة المرور').fill('admin')
  await page.getByRole('button', { name: 'دخول' }).click()
  await page.waitForURL(url => !url.pathname.startsWith('/login'))
}

/** Leave /tasks part-way down and open a row, returning the offset left behind. */
async function leaveListAtOffset(page: Page) {
  await page.goto('/tasks')
  await expect(page.locator('tbody tr').first()).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight)).toBeGreaterThan(LEAVE_AT + 768)
  await page.evaluate(top => window.scrollTo(0, top), LEAVE_AT)
  await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(LEAVE_AT)

  // Open a row that is already on screen and clear of the sticky headers: clicking one that is not would make
  // Playwright scroll it into view first, moving the offset under test.
  const onScreen = await page.evaluate(() => [...document.querySelectorAll('tbody tr')]
    .findIndex((row) => {
      const box = row.getBoundingClientRect()
      return box.top > 200 && box.bottom < window.innerHeight - 20
    }))
  expect(onScreen, 'a row should be on screen at the offset under test').toBeGreaterThan(-1)
  const left = await page.evaluate(() => Math.round(window.scrollY))
  await page.locator('tbody tr').nth(onScreen).locator('td').nth(1).click()
  await page.waitForURL(/\/tasks\/\d+/)
  return left
}

const backControl = (page: Page) => page.getByRole('link', { name: 'العودة إلى المهام' })

test.describe('a list comes back to the row the reader left it on', () => {
  test.beforeEach(async ({ page }) => { await login(page) })

  test('warm: the page back control returns to the remembered offset', async ({ page }) => {
    const left = await leaveListAtOffset(page)
    await backControl(page).click()
    await page.waitForURL(/\/tasks(\?|$)/)
    await expect.poll(() => page.evaluate(() => Math.round(window.scrollY)), { timeout: 10_000 }).toBe(left)
  })

  test('warm: browser back returns to the remembered offset', async ({ page }) => {
    const left = await leaveListAtOffset(page)
    await page.goBack()
    await page.waitForURL(/\/tasks(\?|$)/)
    await expect.poll(() => page.evaluate(() => Math.round(window.scrollY)), { timeout: 10_000 }).toBe(left)
  })

  // Cold means the rows are genuinely not there when the router asks where to
  // scroll: the cache is emptied and the request behind the list is slowed, so
  // the document really is one screen tall at that moment. The restore has to
  // land once the rows arrive rather than clamp to the top.
  test('cold: an emptied cache and a slow list still land on the remembered offset', async ({ page }) => {
    const left = await leaveListAtOffset(page)

    // Reaching the query client is how a test empties the cache without a
    // reload, which would also wipe the remembered offset the push back needs.
    await page.evaluate(() => {
      const root = document.querySelector('#__nuxt') ?? document.body.firstElementChild
      const app = (root as unknown as { __vue_app__?: { _context: { provides: Record<string, { clear(): void }> } } })?.__vue_app__
      app?._context.provides.VUE_QUERY_CLIENT?.clear()
    })
    await page.route('**/api/v1/tasks?**', async (route) => {
      await new Promise(done => setTimeout(done, 1500))
      await route.continue()
    })

    await backControl(page).click()
    await page.waitForURL(/\/tasks(\?|$)/)
    // The document is one screen tall here, so the offset is out of reach.
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThan(left)
    expect(await page.evaluate(() => Math.round(window.scrollY))).toBe(0)

    await expect.poll(() => page.evaluate(() => Math.round(window.scrollY)), { timeout: 15_000 }).toBe(left)
  })

  test('cold: browser back after a reload lands on the offset the browser kept', async ({ page }) => {
    const left = await leaveListAtOffset(page)
    // A reload empties every cache; the browser keeps its own history offset.
    await page.reload()
    await expect(page.locator('h1')).toBeVisible()
    // A freshly loaded document is still finishing its own first navigation —
    // hydrating, and settling the history entry it landed on. Going back before
    // it is quiet races the reload rather than testing the restore.
    await page.waitForLoadState('networkidle')
    await page.route('**/api/v1/tasks?**', async (route) => {
      await new Promise(done => setTimeout(done, 1500))
      await route.continue()
    })

    await page.goBack()
    await page.waitForURL(/\/tasks(\?|$)/)
    await expect.poll(() => page.evaluate(() => Math.round(window.scrollY)), { timeout: 15_000 }).toBe(left)
  })
})
