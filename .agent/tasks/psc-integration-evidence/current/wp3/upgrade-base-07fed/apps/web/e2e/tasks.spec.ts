import { test, expect } from '@playwright/test'
async function login(page) { await page.goto('/login'); await page.getByLabel('اسم المستخدم').fill('admin'); await page.getByLabel('كلمة المرور').fill('admin'); await page.getByRole('button', { name: 'دخول' }).click(); await expect(page).toHaveURL(/\/tasks$/) }
test('my tasks table lists my open tasks, filters and opens the detail page', async ({ page }) => {
  await login(page)
  const projects = await (await page.request.get('/api/v1/projects?minimal=1')).json()
  const name = `E2E table ${Date.now()}`
  await page.request.post('/api/v1/tasks', { data: { name, project_id: projects[0].id } })
  await page.goto('/tasks')
  await expect(page.getByRole('heading', { name: 'مهامي' })).toBeVisible()
  await page.getByPlaceholder('بحث في العناوين…').fill(name)
  const row = page.getByRole('row', { name: new RegExp(name) })
  await expect(row).toBeVisible()
  await expect(row.getByText('قيد التنفيذ')).toBeVisible()
  await page.getByPlaceholder('بحث في العناوين…').fill('zzz-no-such-task')
  await expect(page.getByText('لا نتائج.').filter({ visible: true })).toBeVisible()
  await page.getByPlaceholder('بحث في العناوين…').fill(name)
  await row.click()
  await expect.poll(() => new URL(page.url()).searchParams.get('returnTo')).toBe('/tasks')
  await expect(page.locator('h1')).toHaveText(name)
  await page.goBack()
  await expect(page).toHaveURL(/\/tasks$/)
  await expect(page.getByPlaceholder('بحث في العناوين…')).toHaveValue(name)
})
test('inline transition to done moves the task to the closed filter', async ({ page }) => {
  await login(page)
  const projects = await (await page.request.get('/api/v1/projects?minimal=1')).json()
  const name = `E2E done ${Date.now()}`
  await page.request.post('/api/v1/tasks', { data: { name, project_id: projects[0].id } })
  await page.goto('/tasks')
  await expect(page.getByRole('status', { name: 'متصل' })).toBeVisible()
  const filtered = page.waitForResponse(response => {
    const url = new URL(response.url())
    return response.request().method() === 'GET' && response.status() === 200 && url.pathname === '/api/v1/tasks' && url.searchParams.get('q') === name
  })
  await page.getByPlaceholder('بحث في العناوين…').fill(name)
  expect((await filtered).status()).toBe(200)
  const row = page.getByRole('row', { name: new RegExp(name) })
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: 'قيد التنفيذ' }).click()
  const transitioned = page.waitForResponse((r) => r.url().includes('/transition') && r.request().method() === 'POST')
  const doneItem = page.getByRole('menuitem', { name: 'منجز' })
  await expect(doneItem).toBeVisible()
  await doneItem.focus()
  await page.keyboard.press('Enter')
  const transitionResponse = await transitioned
  expect(transitionResponse.status()).toBe(200)
  await transitionResponse.finished()
  await expect(row).toBeHidden()
  await page.getByRole('tab', { name: 'منجزة' }).click()
  // The closed list is paged (50 rows, starred tasks first); on a long-lived
  // dev DB the new task may not be on page one, so search for it by name.
  await page.getByPlaceholder('بحث في العناوين…').fill(name)
  await expect(page.getByRole('row', { name: new RegExp(name) })).toBeVisible()
})
test('closed tab shows a closed-specific empty state with no create action', async ({ page }) => {
  await login(page)
  await page.goto('/tasks')
  await expect(page.getByRole('heading', { name: 'مهامي' })).toBeVisible()
  // The tabs are gated by useHydrated(): they stay disabled until Nuxt has
  // hydrated, so a click that lands after they enable can never be dropped.
  // No retry loop is needed.
  const closedTab = page.getByRole('tab', { name: 'منجزة' })
  await expect(closedTab).toBeEnabled()
  await closedTab.click()
  await expect(closedTab).toHaveAttribute('aria-selected', 'true')
  // Filtered case: a nonsense search on the closed tab is unambiguous — "no
  // results", not "no completed tasks" — regardless of what earlier tests
  // left behind.
  await page.getByPlaceholder('بحث في العناوين…').fill('zzz-no-such-closed-task')
  await expect(page.getByText('لا نتائج.').filter({ visible: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'إنشاء مهمة' })).toHaveCount(0)
  // Clear the search: whether or not closed tasks exist (earlier e2e runs
  // create them), the create action must stay hidden on the closed tab; the
  // closed-empty copy only applies when the row count is actually zero.
  await page.getByPlaceholder('بحث في العناوين…').fill('')
  await expect(page.getByRole('button', { name: 'إنشاء مهمة' })).toHaveCount(0)
  // Data rows carry a StateMenu trigger button; the empty-state row does
  // not (its only button, when present, is the create action already
  // asserted absent above) — this distinguishes "0 closed tasks" from "1+
  // closed tasks" without depending on run order across the suite.
  const dataRows = page.locator('tbody tr').filter({ has: page.getByRole('button') })
  // The search clear is debounced (300ms) and then refetched; poll instead
  // of reading the count immediately, which would still see the "zzz…"
  // filtered (empty) result and race the settled state.
  await expect
    .poll(async () => (await dataRows.count()) > 0 || (await page.getByText('لا مهام منجزة بعد').filter({ visible: true }).isVisible()))
    .toBe(true)
  if ((await dataRows.count()) === 0) {
    await expect(page.getByText('لا مهام منجزة بعد').filter({ visible: true })).toBeVisible()
  }
})

test('task creation is a reloadable page with a safe return target', async ({ page }) => {
  await login(page)
  await page.goto('/tasks?q=return-check')
  await page.getByRole('button', { name: 'مهمة جديدة' }).click()
  await expect.poll(() => new URL(page.url()).searchParams.get('returnTo')).toBe('/tasks?q=return-check')
  await page.reload()
  await expect(page.getByRole('heading', { name: 'مهمة جديدة' })).toBeVisible()
  await expect(page.getByTestId('task-create-form')).toBeVisible()
  await expect(page.locator('[data-slot="dialog-content"], [data-slot="sheet-content"], [data-slot="dialog-overlay"], [data-slot="sheet-overlay"]')).toHaveCount(0)
  await page.getByRole('button', { name: 'إلغاء' }).click()
  await expect(page).toHaveURL(/\/tasks\?q=return-check/)
})
