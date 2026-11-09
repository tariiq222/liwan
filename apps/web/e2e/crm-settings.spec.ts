import { test, expect, type Page } from '@playwright/test'

// Runs against the isolated synthetic stack (MODULE_UI_PREVIEW=1): the CRM mock keeps state, reset before each test.
test.skip(process.env.E2E_PROJECT_POPUPS !== '1', 'the CRM settings checks run on the isolated mock stack (npm run e2e:mock)')

async function login(page: Page) {
  await page.goto('/login')
  await expect(page.getByRole('button', { name: 'دخول', exact: true })).toBeEnabled()
  await page.getByLabel('اسم المستخدم').fill('admin')
  await page.getByLabel('كلمة المرور', { exact: true }).fill('admin')
  await page.getByRole('button', { name: 'دخول', exact: true }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

test.beforeEach(async ({ page }) => {
  await login(page)
  const reset = await page.request.post('/api/v1/__mock/reset-crm', { data: {} })
  expect(reset.ok()).toBe(true)
  await page.goto('/settings/apps/crm')
})

test('the preset card offers the two existing and the three sector presets', async ({ page }) => {
  await page.locator('#crm-preset').click()
  for (const name of ['عام', 'اتصال وباقات', 'خدمات احترافية', 'مشاريع وعقود', 'تعليم وتدريب']) {
    await expect(page.getByRole('option', { name, exact: true })).toBeVisible()
  }
})

test('the page opens on the basics tab, each tab shows only its own cards, and the sidebar lists no CRM parts', async ({ page }) => {
  await expect(page.getByTestId('settings-tab-basics')).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('#terms')).toBeVisible()
  await expect(page.locator('#privacy')).toBeHidden()
  await expect(page.locator('a[href*="/settings/apps/crm"][href*="#"]')).toHaveCount(0)
  await page.getByTestId('settings-tab-workflow').click()
  await expect(page).toHaveURL(/tab=workflow/)
  await expect(page.locator('#followup')).toBeVisible()
  await expect(page.locator('#terms')).toBeHidden()
})

test('a draft on one tab survives switching tabs and the one save bar saves it', async ({ page }) => {
  await page.goto('/settings/apps/crm?tab=privacy')
  await page.locator('#privacy').getByRole('switch', { name: 'سجل الاطلاع' }).click()
  await expect(page.getByTestId('settings-save-bar')).toBeVisible()
  await page.getByTestId('settings-tab-sales').click()
  await expect(page.getByTestId('settings-save-bar')).toContainText('1')
  await page.getByTestId('settings-tab-privacy').click()
  await expect(page.locator('#privacy').getByRole('switch', { name: 'سجل الاطلاع' })).toBeChecked()
  await page.getByTestId('settings-save-bar-save').click()
  await expect(page.getByTestId('settings-save-bar')).toBeHidden()
})

test('the save bar saves two cards of the shared settings in one press without a revision conflict', async ({ page }) => {
  await page.goto('/settings/apps/crm?tab=workflow')
  await page.locator('#distribution-mode').click()
  await page.getByRole('option').nth(1).click()
  const retry = page.locator('#followup').getByRole('switch').first()
  const retryWas = await retry.isChecked()
  await retry.click()
  await expect(page.getByTestId('settings-save-bar')).toContainText('2')
  await page.getByTestId('settings-save-bar-save').click()
  await expect(page.getByTestId('settings-save-bar')).toBeHidden()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.reload()
  await expect(page.locator('#followup').getByRole('switch').first()).toBeChecked({ checked: !retryWas })
})

test('the privacy card offers own and everyone, never the removed team mode', async ({ page }) => {
  await page.goto('/settings/apps/crm?tab=privacy')
  await page.locator('#visibility').click()
  await expect(page.getByRole('option', { name: 'فرصه فقط', exact: true })).toBeVisible()
  await expect(page.getByRole('option', { name: 'الجميع', exact: true })).toBeVisible()
  await expect(page.getByRole('option', { name: 'فريقه', exact: true })).toHaveCount(0)
})

test('the privacy card saves the view log switch', async ({ page }) => {
  await page.goto('/settings/apps/crm?tab=privacy')
  const card = page.locator('#privacy')
  const log = card.getByRole('switch', { name: 'سجل الاطلاع' })
  await expect(log).not.toBeChecked()
  await log.click()
  await page.getByTestId('settings-save-bar-save').click()
  await page.reload()
  await expect(page.locator('#privacy').getByRole('switch', { name: 'سجل الاطلاع' })).toBeChecked()
})

test('the privacy card keeps the view log retention only while the log is on', async ({ page }) => {
  await page.goto('/settings/apps/crm?tab=privacy')
  const card = page.locator('#privacy')
  const log = card.getByRole('switch', { name: 'سجل الاطلاع' })
  // The retention input appears with the log: the window only means something while openings are recorded.
  await expect(card.locator('#view-log-retention')).toHaveCount(0)
  await log.click()
  await card.locator('#view-log-retention').fill('6')
  await page.getByTestId('settings-save-bar-save').click()
  await expect(page.getByTestId('settings-save-bar')).toBeHidden()
  await page.reload()
  await expect(page.locator('#privacy #view-log-retention')).toHaveValue('6')
})

test('the pricing card saves the discount ceiling and the above-list policy', async ({ page }) => {
  await page.goto('/settings/apps/crm?tab=sales')
  const card = page.locator('#pricing')
  const allowed = card.getByRole('switch', { name: 'السماح بالخصم' })
  if (!(await allowed.isChecked())) await allowed.click()
  await card.locator('#discount-max').fill('25')
  await card.locator('#price-above-list').click()
  await page.getByRole('option', { name: 'ممنوع', exact: true }).click()
  await page.getByTestId('settings-save-bar-save').click()
  await page.reload()
  await expect(page.locator('#pricing #discount-max')).toHaveValue('25')
  await expect(page.locator('#pricing #price-above-list')).toContainText('ممنوع')
})
