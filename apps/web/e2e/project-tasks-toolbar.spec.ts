import { expect, test, type Page } from '@playwright/test'

// The project tasks tab toolbar (isolated mock stack): one row with the search, a «فلاتر» popover with a count, the
// open / done / archived scope, the «الأعمدة» menu and the list / board / timeline switch; chips only while a filter is set.
async function login(page: Page) {
  const response = await page.request.post('/api/auth/login', { data: { login: process.env.E2E_ADMIN_LOGIN ?? 'admin', password: process.env.E2E_ADMIN_PASSWORD ?? 'admin' } })
  expect(response.status()).toBe(200)
}
async function open(page: Page, path: string) {
  await page.goto(path)
  await expect(page.getByTestId('global-search-trigger')).toBeEnabled()
  await expect(page.getByTestId('task-filters-button')).toBeEnabled()
}
const horizontalScroll = (page: Page) => page.evaluate(() => {
  const scroller = document.querySelector<HTMLElement>('[data-slot="root"]')
  return { page: document.documentElement.scrollWidth > window.innerWidth, table: scroller ? scroller.scrollWidth > scroller.clientWidth : false }
})

test.describe('project tasks toolbar', () => {
  test.use({ viewport: { width: 1440, height: 900 } })
  test.beforeEach(async ({ page }) => { await login(page) })

  test('is one row and draws no chips until a filter is set', async ({ page }) => {
    await open(page, '/projects/1/tasks')
    const toolbar = page.getByTestId('task-toolbar')
    const row = toolbar.locator('[data-slot="filter-row"]')
    const tops = await row.locator('input, [data-testid="task-filters-button"], [data-testid="task-scope"], [data-testid="task-view-switch"]').evaluateAll(nodes => nodes.map(node => Math.round(node.getBoundingClientRect().top / 8)))
    expect(new Set(tops).size, 'the controls share one row').toBeLessThanOrEqual(2)
    await expect(page.getByTestId('task-filter-chips')).toHaveCount(0)
    await expect(page.getByTestId('task-filters-count')).toHaveCount(0)
    await expect(page.getByTestId('project-tasks-view-timeline')).toBeVisible()
  })

  test('the filters popover counts, chips and clears; Escape closes it and returns focus', async ({ page }) => {
    await open(page, '/projects/1/tasks')
    const button = page.getByTestId('task-filters-button')
    await button.click()
    const popover = page.getByTestId('task-filters-popover')
    await expect(popover).toBeVisible()
    // Each choice is written to the URL, which the next one builds on: wait for it like a person would.
    await popover.getByTestId('task-filter-priority').getByRole('button', { name: 'عاجلة' }).click()
    await expect(page).toHaveURL(/priority=3/)
    await popover.getByTestId('task-filter-assignee').getByRole('button', { name: 'أنا' }).click()
    await expect(page).toHaveURL(/assignee=me/)
    await expect(page.getByTestId('task-filters-count')).toHaveText('2')
    await expect(page.getByTestId('task-filters-live')).not.toHaveText('')
    await page.keyboard.press('Escape')
    await expect(popover).toBeHidden()
    await expect(button).toBeFocused()
    const chips = page.getByTestId('task-filter-chips')
    await expect(chips.getByRole('button', { name: /عاجلة/ })).toBeVisible()
    await chips.getByRole('button', { name: /عاجلة/ }).click()
    await expect(page.getByTestId('task-filters-count')).toHaveText('1')
    await expect(page).not.toHaveURL(/priority=/)
    await chips.getByRole('button', { name: 'مسح الفلاتر' }).click()
    await expect(page.getByTestId('task-filter-chips')).toHaveCount(0)
    await expect(page).not.toHaveURL(/assignee=/)
  })

  test('the scope group switches open, done and archived without a floating link', async ({ page }) => {
    await open(page, '/projects/1/tasks')
    await expect(page.getByRole('link', { name: 'المهام المؤرشفة' })).toHaveCount(0)
    const scope = page.getByTestId('task-scope')
    await scope.getByRole('button', { name: 'منجزة' }).click()
    await expect(page).toHaveURL(/closed=1/)
    await expect(scope.getByRole('button', { name: 'منجزة' })).toHaveAttribute('aria-pressed', 'true')
    await scope.getByRole('button', { name: 'مؤرشفة' }).click()
    await expect(page).toHaveURL(/scope=archived/)
    await expect(page).not.toHaveURL(/closed=1/)
    await expect(page.getByTestId('archived-tasks-count')).toBeVisible()
    await expect(page.getByTestId('task-filters-button')).toHaveCount(0)
    await scope.getByRole('button', { name: 'مفتوحة' }).click()
    await expect(page).not.toHaveURL(/scope=archived/)
    await expect(page.getByTestId('tasks-result-count')).toBeVisible()
  })

  test('the view switch opens the list, the board and the timeline', async ({ page }) => {
    await open(page, '/projects/1/tasks')
    await page.getByTestId('project-tasks-view-board').click()
    await expect(page).toHaveURL(/view=board/)
    await expect(page.getByTestId('project-tasks-view-board')).toHaveAttribute('aria-pressed', 'true')
    await page.getByTestId('project-tasks-view-timeline').click()
    await expect(page).toHaveURL(/view=timeline/)
    await expect(page.getByTestId('schedule-gantt-scroller')).toBeVisible()
    await expect(page.getByTestId('timeline-today')).toBeVisible()
    await expect(page.getByTestId('task-filters-button')).toHaveCount(0)
    await page.getByTestId('timeline-scale').getByRole('button', { name: 'شهري' }).click()
    await expect(page).toHaveURL(/scale=month/)
    await page.getByTestId('project-tasks-view-table').click()
    await expect(page).not.toHaveURL(/view=/)
    await expect(page.locator('tbody tr[data-shortcut-row]').first()).toBeVisible()
  })

  test('the old planning links land on the timeline view', async ({ page }) => {
    await login(page)
    await page.goto('/projects/1/schedule?scale=month')
    await expect(page).toHaveURL(/\/projects\/1\/tasks\?(?=.*view=timeline)(?=.*scale=month)/)
    await expect(page.getByTestId('schedule-gantt-scroller')).toBeVisible()
  })

  test('the columns menu hides and shows columns and remembers the choice', async ({ page }) => {
    await open(page, '/projects/1/tasks')
    const headers = page.locator('thead th')
    await expect(headers.filter({ hasText: 'المرحلة' })).toHaveCount(0)
    await expect(headers.filter({ hasText: 'المسؤول' })).toHaveCount(1)
    await expect(page.locator('thead th span[title="الرقم"]')).toHaveCount(0)
    await page.getByTestId('task-columns-button').click()
    await page.getByRole('menuitemcheckbox', { name: 'المرحلة' }).click()
    await page.getByRole('menuitemcheckbox', { name: 'الرقم' }).click()
    await page.keyboard.press('Escape')
    await expect(headers.filter({ hasText: 'المرحلة' })).toHaveCount(1)
    await expect(page.locator('thead th span[title="الرقم"]')).toHaveCount(1)
    await page.reload()
    await expect(headers.filter({ hasText: 'المرحلة' })).toHaveCount(1)
    await page.getByTestId('task-columns-button').click()
    await page.getByRole('menuitemcheckbox', { name: 'المرحلة' }).click()
    await page.getByRole('menuitemcheckbox', { name: 'الرقم' }).click()
    await page.keyboard.press('Escape')
    await expect(headers.filter({ hasText: 'المرحلة' })).toHaveCount(0)
  })

  test('the due date is a plain date and the assignee shows a name', async ({ page }) => {
    await open(page, '/projects/1/tasks')
    const first = page.locator('tbody tr[data-shortcut-row]').first()
    await expect(first.getByTestId('deadline-badge')).toHaveText(/\d{2}\/\d{2}\/\d{4}/)
    await expect(first.getByTestId('deadline-badge')).not.toContainText('متبقي')
    await expect(first.getByTestId('task-assignee')).not.toBeEmpty()
  })

  test.describe('at 1280px', () => {
    test.use({ viewport: { width: 1280, height: 800 } })
    test('the table does not scroll sideways', async ({ page }) => {
      await open(page, '/projects/1/tasks')
      await expect(page.locator('tbody tr[data-shortcut-row]').first()).toBeVisible()
      expect(await horizontalScroll(page)).toEqual({ page: false, table: false })
    })
  })
})
