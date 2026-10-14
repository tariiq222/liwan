import { expect, test, type Page } from '@playwright/test'
import { requireStorybook, startStorybookServer } from './support/storybookServer'

// Behaviour of the Plan 4 page templates in their stories. Screenshots and axe live in storybook-visual.spec.ts.
let base = ''
let close: () => Promise<void> = async () => {}
const open = async (page: Page, id: string, globals = 'locale:ar;appearance:light') => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(`${base}/iframe.html?id=${id}&viewMode=story&globals=${globals}`)
  // A route-backed panel hides the root (aria-hidden) while its dialog is open, so only wait for it to exist.
  await page.locator('#storybook-root').waitFor({ state: 'attached' })
}
const route = (page: Page) => page.getByTestId('story-route')

test.describe('Tasmim page templates', () => {
  requireStorybook()
  test.beforeAll(async () => { ({ base, close } = await startStorybookServer()) })
  test.afterAll(async () => { await close() })

  test('J and K move between DataTable rows on desktop, clamp at the ends, and Enter opens the row', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await open(page, 'shared-datatable--default')
    const rows = page.locator('tbody tr[data-shortcut-row]')
    await expect(rows).toHaveCount(3)
    await page.keyboard.press('j')
    await expect(rows.nth(0)).toBeFocused()
    await page.keyboard.press('k')
    await expect(rows.nth(0)).toBeFocused()
    for (let i = 0; i < 4; i++) await page.keyboard.press('j')
    await expect(rows.nth(2)).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(route(page)).toHaveText('/projects/3')
  })

  test('J and K move only between visible DataTable rows on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await open(page, 'shared-datatable--default')
    const items = page.locator('li[data-shortcut-row]')
    await expect(page.locator('tbody tr[data-shortcut-row]')).toHaveCount(3)
    await page.keyboard.press('j')
    await expect(items.nth(0)).toBeFocused()
    await page.keyboard.press('j')
    await expect(items.nth(1)).toBeFocused()
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('table')))).toBe(false)
    await page.keyboard.press('Enter')
    await expect(route(page)).toHaveText('/projects/2')
  })

  test('a click on a row background opens it; a click on its checkbox only selects it', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await open(page, 'shared-datatable--selectable')
    await expect(page.getByRole('toolbar')).toContainText('1')
    await page.getByRole('checkbox', { name: 'تحديد الصف' }).nth(0).click()
    await expect(page.getByRole('toolbar')).toContainText('2')
    await expect(route(page)).toHaveText('/')
    await page.getByRole('button', { name: 'إلغاء التحديد' }).click()
    await expect(page.getByRole('toolbar')).toHaveCount(0)
    await page.locator('tbody tr[data-shortcut-row]').nth(1).locator('td').last().click()
    await expect(route(page)).toHaveText('/projects/2')
  })

  test('the view switch writes ?view= and the default view leaves no query', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await open(page, 'shared-listpage--default')
    const table = page.getByRole('button', { name: 'عرض الجدول' })
    const board = page.getByRole('button', { name: 'عرض اللوحة' })
    await expect(board).toBeEnabled()
    await expect(table).toHaveAttribute('aria-pressed', 'true')
    await board.click()
    await expect(route(page)).toHaveText('/projects?view=board')
    await expect(board).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('#storybook-root table')).toHaveCount(0)
    await table.click()
    await expect(route(page)).toHaveText('/projects')
    await expect(page.locator('#storybook-root table')).toHaveCount(1)
  })

  test('a ?view=board link opens the board', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await open(page, 'shared-listpage--board')
    await expect(page.getByRole('button', { name: 'عرض اللوحة' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('#storybook-root table')).toHaveCount(0)
  })

  test('C presses the list page create button and / focuses its search', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await open(page, 'shared-listpage--in-shell')
    await expect(page.getByTestId('global-search-trigger')).toBeEnabled()
    await expect(page.locator('[data-shortcut-create]')).toHaveCount(1)
    await page.getByRole('heading', { level: 1 }).click()
    await page.keyboard.press('/')
    await expect(page.locator('[data-shortcut-search] input')).toBeFocused()
    await page.getByRole('heading', { level: 1 }).click()
    await page.keyboard.press('c')
    await expect(route(page)).toHaveText('/projects/new?from=list-page')
  })
})

test.describe('Tasmim record template', () => {
  requireStorybook()
  test.beforeAll(async () => { ({ base, close } = await startStorybookServer()) })
  test.afterAll(async () => { await close() })

  test('RecordPage puts the properties at the inline end on desktop and after the main column on mobile', async ({ page }) => {
    for (const [locale, dir] of [['ar', 'rtl'], ['en', 'ltr']] as const) {
      await page.setViewportSize({ width: 1440, height: 900 })
      await open(page, 'shared-recordpage--default', `locale:${locale};appearance:light`)
      const main = (await page.locator('[data-slot="record-main"]').boundingBox())!
      const aside = (await page.getByRole('complementary').boundingBox())!
      if (dir === 'rtl') expect(aside.x + aside.width).toBeLessThanOrEqual(main.x + 1)
      else expect(aside.x).toBeGreaterThanOrEqual(main.x + main.width - 1)
      await page.setViewportSize({ width: 390, height: 844 })
      const stackedMain = (await page.locator('[data-slot="record-main"]').boundingBox())!
      const stackedAside = (await page.getByRole('complementary').boundingBox())!
      expect(stackedAside.y).toBeGreaterThanOrEqual(stackedMain.y + stackedMain.height - 1)
    }
  })

  test('PropertyRow shows a dash for an empty value and names it for screen readers', async ({ page }) => {
    await open(page, 'shared-propertyrow--empty')
    const value = page.locator('dd')
    await expect(value).toHaveText(/—\s*لا قيمة/)
    await expect(value.locator('[aria-hidden="true"]')).toHaveText('—')
  })
})

test.describe('Tasmim form template', () => {
  requireStorybook()
  test.beforeAll(async () => { ({ base, close } = await startStorybookServer()) })
  test.afterAll(async () => { await close() })

  test('the create panel dialog is named by its heading', async ({ page }) => {
    await open(page, 'shared-createpanel--form')
    await expect(page.getByRole('dialog', { name: 'مهمة جديدة' })).toBeVisible()
  })

  test('the Form template asks before closing a dirty draft and stays when told to', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await open(page, 'shared-createpanel--form-template')
    const panel = page.getByRole('dialog', { name: 'مهمة جديدة' })
    const name = panel.getByRole('textbox', { name: /عنوان المهمة/ })
    await expect(name).toBeEnabled()
    await name.fill('تقرير الربع')
    await panel.getByRole('button', { name: 'إغلاق' }).click()
    const guard = page.getByTestId('unsaved-changes-dialog')
    await expect(guard).toBeVisible()
    await guard.getByRole('button', { name: 'البقاء في الصفحة' }).click()
    await expect(guard).toBeHidden()
    await expect(panel).toBeVisible()
    await expect(name).toHaveValue('تقرير الربع')
  })

  test('a clean Form template closes without asking', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await open(page, 'shared-createpanel--form-template')
    const panel = page.getByRole('dialog', { name: 'مهمة جديدة' })
    await expect(panel).toBeVisible()
    await panel.getByRole('button', { name: 'إغلاق' }).click()
    await expect(page.getByTestId('unsaved-changes-dialog')).toHaveCount(0)
    await expect(panel).toHaveCount(0)
  })
})
