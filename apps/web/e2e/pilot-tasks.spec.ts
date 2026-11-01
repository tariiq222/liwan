import { expect, test, type Page } from '@playwright/test'

// Plan 5 pilot: /tasks and /projects/1/tasks on SharedListPage + SharedDataTable (isolated mock stack).
// The mock lists four tasks, all in project 1 «مشروع ألفا».
const ADMIN_LOGIN = process.env.E2E_ADMIN_LOGIN ?? 'admin'
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'admin'
async function login(page: Page) {
  const response = await page.request.post('/api/auth/login', { data: { login: ADMIN_LOGIN, password: ADMIN_PASSWORD } })
  expect(response.status()).toBe(200)
}
async function open(page: Page, path: string) {
  await page.goto(path)
  await expect(page.getByTestId('global-search-trigger')).toBeEnabled()
}
const rows = (page: Page) => page.locator('tbody tr[data-shortcut-row]')
const mobileRows = (page: Page) => page.locator('li[data-shortcut-row]')
const fitsWidth = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

test.describe('Plan 5 pilot: the task lists', () => {
  test.beforeEach(async ({ page }) => { await login(page) })

  test.describe('desktop', () => {
    test.use({ viewport: { width: 1440, height: 900 } })

    test('/tasks is the list template with a table, the page create button and one heading', async ({ page }) => {
      await open(page, '/tasks')
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
      await expect(page.locator('[data-template="list"]')).toHaveCount(1)
      await expect(rows(page)).toHaveCount(4)
      const create = page.locator('[data-shortcut-create]')
      await expect(create).toHaveCount(1)
      await expect(create).toContainText('مهمة مشروع جديدة')
      await expect(page.getByTestId('deadline-badge').first()).toBeVisible()
      await expect(rows(page).first().getByRole('link').first()).toHaveAttribute('href', /\/tasks\/\d+/)
      await expect(rows(page).first().getByRole('button').first()).toBeVisible()
    })

    test('an unknown ?view= shows the table and ?view=board survives a task round trip', async ({ page }) => {
      await open(page, '/tasks?view=gantt')
      await expect(rows(page)).toHaveCount(4)
      await open(page, '/tasks')
      await page.locator('[data-value="board"]').click()
      await expect(page).toHaveURL(/\/tasks\?view=board$/)
      await expect(page.getByTestId('board-column').first()).toBeVisible()
      await page.getByTestId('board-card-101').click()
      await expect(page).toHaveURL(/\/tasks\/101/)
      await page.goBack()
      await expect(page).toHaveURL(/\/tasks\?view=board$/)
      await page.locator('[data-value="table"]').click()
      await expect(page).toHaveURL(/\/tasks$/)
      await expect(rows(page)).toHaveCount(4)
    })

    test('J and K move through the rows, / focuses the search and C creates a task', async ({ page }) => {
      await open(page, '/tasks')
      await page.getByRole('heading', { level: 1 }).click()
      await page.keyboard.press('j')
      await expect(rows(page).nth(0)).toBeFocused()
      await page.keyboard.press('j')
      await expect(rows(page).nth(1)).toBeFocused()
      await page.keyboard.press('k')
      await expect(rows(page).nth(0)).toBeFocused()
      await page.keyboard.press('/')
      await expect(page.locator('[data-shortcut-search] input')).toBeFocused()
      await page.getByRole('heading', { level: 1 }).click()
      await page.keyboard.press('c')
      await expect(page).toHaveURL(/\/tasks\/new\?returnTo=/)
    })

    test('Enter on a focused task row opens that task', async ({ page }) => {
      await open(page, '/tasks')
      await page.getByRole('heading', { level: 1 }).click()
      await page.keyboard.press('j')
      await expect(rows(page).nth(0)).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(page).toHaveURL(/\/tasks\/\d+/)
    })

    test('a click on the state menu does not open the task, a click on the row does', async ({ page }) => {
      await open(page, '/tasks')
      await rows(page).first().getByRole('button').first().click()
      await expect(page).toHaveURL(/\/tasks$/)
      await page.keyboard.press('Escape')
      await rows(page).first().locator('td').nth(1).click({ position: { x: 4, y: 4 } })
      await expect(page).toHaveURL(/\/tasks\/\d+/)
    })

    test('the project tab keeps the frame heading as the only heading and a header-level create button', async ({ page }) => {
      await open(page, '/projects/1/tasks')
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('مشروع ألفا')
      await expect(page.locator('main h2')).toHaveCount(0)
      await expect(page.getByTestId('project-workspace-tabs')).toHaveCount(1)
      const create = page.getByTestId('project-header-create')
      await expect(create).toHaveAttribute('data-shortcut-create', '')
      await expect(page.locator('main [data-slot="page-header"]').getByTestId('project-header-create')).toBeVisible()
      await expect(rows(page)).toHaveCount(4)
      await expect(page.getByRole('link', { name: 'المهام المؤرشفة' })).toBeVisible()
    })

    test('the project tab switches to the board with ?view=board and back, keeping its filters', async ({ page }) => {
      await open(page, '/projects/1/tasks?q=%D9%85%D9%87%D9%85%D8%A9')
      await page.getByRole('button', { name: 'لوحة', exact: true }).click()
      await expect(page).toHaveURL(/\/projects\/1\/tasks\?(?=.*q=)(?=.*view=board)/)
      await expect(page.getByTestId('board-column').first()).toBeVisible()
      await page.getByRole('button', { name: 'قائمة', exact: true }).click()
      await expect.poll(() => new URL(page.url()).searchParams.has('view')).toBe(false)
      expect(new URL(page.url()).searchParams.get('q')).toBe('مهمة')
      await expect(rows(page)).toHaveCount(4)
    })

    test('a task opened from the project tab returns to the tab with its filters', async ({ page }) => {
      await open(page, '/projects/1/tasks?q=%D9%85%D9%87%D9%85%D8%A9')
      await rows(page).first().getByRole('link').first().click()
      await expect(page).toHaveURL(/\/projects\/1\/tasks\/\d+/)
      expect(new URL(page.url()).searchParams.get('q')).toBe('مهمة')
      await page.goBack()
      await expect(page).toHaveURL(/\/projects\/1\/tasks\?/)
      await expect(rows(page)).toHaveCount(4)
    })

    test('the task tab of a missing project shows the not-found block and no list', async ({ page }) => {
      await page.goto('/projects/999/tasks')
      await expect(page.getByText('المشروع غير موجود أو لا تملك صلاحية عرضه')).toBeVisible()
      await expect(page.locator('[data-template="list"]')).toHaveCount(0)
    })
  })

  test.describe('phone', () => {
    test.use({ viewport: { width: 390, height: 844 } })

    test('on a 390px phone the mobile rows carry the same information and J skips the hidden table', async ({ page }) => {
      await open(page, '/tasks')
      await expect(mobileRows(page)).toHaveCount(4)
      await expect(page.locator('table')).toBeHidden()
      const first = mobileRows(page).first()
      await expect(first).toContainText('مهمة')
      await expect(first.getByTestId('deadline-badge')).toBeVisible()
      await expect(first.getByRole('button').first()).toBeVisible()
      await expect(first.getByRole('combobox')).toBeVisible()
      expect(await fitsWidth(page)).toBe(true)
      await page.getByRole('heading', { level: 1 }).click()
      await page.keyboard.press('j')
      await expect(mobileRows(page).nth(0)).toBeFocused()
      await page.keyboard.press('j')
      await expect(mobileRows(page).nth(1)).toBeFocused()
    })

    test('the project tab fits the phone width', async ({ page }) => {
      await open(page, '/projects/1/tasks')
      await expect(mobileRows(page)).toHaveCount(4)
      expect(await fitsWidth(page)).toBe(true)
    })
  })
})
