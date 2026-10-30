import { expect, test } from '@playwright/test'
import { enterFoundation } from './support/uxFoundations'

test.describe.configure({ timeout: 60_000 })

test('employee creation explains a missing name instead of disabling an unexplained save', async ({ page }) => {
  await enterFoundation(page, '/hr/employees/new')
  const submit = page.getByRole('dialog').locator('button[type="submit"]')
  await expect(submit).toBeEnabled()
  await submit.click()
  await expect(page.locator('#hr-employee-name')).toBeFocused()
  await expect(page.locator('#hr-employee-name')).toHaveAttribute('aria-invalid', 'true')
})

test('required fields explain a failed attempt and focus the field instead of silently disabling creation', async ({ page }) => {
  await enterFoundation(page, '/settings/team/roles/new')
  const submit = page.getByRole('button', { name: 'إنشاء دور', exact: true })
  await expect(submit).toBeEnabled()
  await submit.click()
  await expect(page.locator('#name-ar')).toBeFocused()
  await expect(page.locator('#name-ar')).toHaveAttribute('aria-invalid', 'true')
  await expect(page.getByRole('dialog')).toContainText('أدخل الاسم بالعربية')
})

test('a delayed duplicate submit sends once and a field error preserves the draft', async ({ page }) => {
  let count = 0
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/v1/admin/roles', async route => {
    if (route.request().method() !== 'POST') return route.continue()
    count++
    await gate
    await route.fulfill({ status: 422, json: { code: 'invalid', message: 'الاسم مستخدم، اختر اسمًا آخر.', field: 'name.ar' } })
  })
  await enterFoundation(page, '/settings/team/roles/new')
  await page.locator('#name-ar').fill('دور رحلة الحفظ')
  await page.getByRole('button', { name: 'إنشاء دور', exact: true }).dblclick()
  await expect.poll(() => count).toBe(1)
  await expect(page.getByRole('button', { name: 'إنشاء دور', exact: true })).toBeDisabled()
  release()
  await expect(page.getByRole('dialog')).toContainText('الاسم مستخدم، اختر اسمًا آخر.')
  await expect(page.locator('#name-ar')).toHaveValue('دور رحلة الحفظ')
  await expect(page.locator('#name-ar')).toHaveAttribute('aria-invalid', 'true')
  expect(count).toBe(1)
})

test('an interrupted save states that the outcome is unknown and never retries automatically', async ({ page }) => {
  let count = 0
  await page.route('**/api/v1/admin/roles', async route => {
    if (route.request().method() !== 'POST') return route.continue()
    count++
    await route.abort('connectionfailed')
  })
  await enterFoundation(page, '/settings/team/roles/new')
  await page.locator('#name-ar').fill('دور اتصال منقطع')
  await page.getByRole('button', { name: 'إنشاء دور', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('لم نتأكد من اكتمال الحفظ')
  await expect(page.locator('#name-ar')).toHaveValue('دور اتصال منقطع')
  expect(count).toBe(1)
})

test('closing a dirty creation offers staying and keeps the draft', async ({ page }) => {
  await enterFoundation(page, '/settings/team/roles/new')
  await page.locator('#name-ar').fill('مسودة باقية')
  await page.getByRole('dialog').getByRole('button', { name: 'إغلاق', exact: true }).click()
  const guard = page.getByTestId('unsaved-changes-dialog')
  await expect(guard).toBeVisible()
  await guard.getByRole('button', { name: 'البقاء في الصفحة', exact: true }).click()
  await expect(page.locator('#name-ar')).toHaveValue('مسودة باقية')
  await expect(page).toHaveURL(/\/settings\/team\/roles\/new$/)
})

for (const status of [403, 409, 500]) {
  test(`a ${status} save rejection keeps the draft and never reports success`, async ({ page }) => {
    await page.route('**/api/v1/admin/roles', route => route.request().method() === 'POST'
      ? route.fulfill({ status, json: { code: status === 409 ? 'conflict' : status === 403 ? 'forbidden' : 'internal', message: 'تعذر إتمام الطلب' } })
      : route.continue())
    await enterFoundation(page, '/settings/team/roles/new')
    await page.locator('#name-ar').fill('مسودة لم تحفظ')
    await page.locator('#name-ar').press('Enter')
    await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible()
    await expect(page.locator('#name-ar')).toHaveValue('مسودة لم تحفظ')
    await expect(page).toHaveURL(/\/roles\/new$/)
  })
}

test('a settings card saves its draft with one button and keeps the draft locked while the save is pending', async ({ page }) => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/v1/settings/projects', async route => {
    if (route.request().method() !== 'PATCH') return route.continue()
    await gate
    await route.continue()
  })
  await enterFoundation(page, '/settings/apps/projects')
  const card = page.locator('#project-creation')
  const control = card.getByRole('switch', { name: 'يشترط مدير المشروع', exact: true })
  // The footer sits after the card section inside the card's form.
  const save = page.locator('form', { has: card }).getByRole('button', { name: 'حفظ التغييرات', exact: true })
  await expect(control).toBeEnabled()
  await expect(save).toBeDisabled()
  await control.click()
  await expect(save).toBeEnabled()
  await save.click()
  try {
    await expect(control).toBeDisabled()
  } finally { release() }
  await expect(control).toBeEnabled()
  await expect(save).toBeDisabled()
})

test('a stage save failure retains its stage draft and retries only on request', async ({ page }) => {
  const patches: unknown[] = []
  await page.route('**/api/v1/settings/projects', async route => {
    if (route.request().method() !== 'PATCH') return route.continue()
    patches.push(route.request().postDataJSON())
    if (patches.length === 1) return route.fulfill({ status: 500, json: { code: 'internal', message: 'تعذر حفظ الإعدادات' } })
    await route.continue()
  })
  await enterFoundation(page, '/settings/apps/projects')
  const name = 'مرحلة محفوظة بعد إعادة المحاولة'
  await page.getByTestId('stage-add-input').fill(name)
  await page.getByTestId('stage-add-input').press('Enter')
  const feedback = page.getByTestId('stage-save-feedback')
  await expect(feedback).toContainText('تعذر حفظ الإعدادات')
  await expect(page.getByTestId('stage-row').filter({ hasText: name })).toBeVisible()
  expect(patches).toHaveLength(1)
  await feedback.getByRole('button', { name: 'إعادة المحاولة', exact: true }).click()
  await expect(feedback).toHaveCount(0)
  expect(patches).toHaveLength(2)
  expect(patches[1]).toEqual(patches[0])
  await expect(page.getByTestId('stage-row').filter({ hasText: name })).toBeVisible()
})

for (const action of ['cancel', 'escape', 'navigation', 'back']) {
  test(`dirty creation protects a ${action} departure`, async ({ page }) => {
    await enterFoundation(page, '/my-tasks')
    await page.getByTestId('global-search-trigger').click()
    await page.keyboard.press('Escape')
    await page.getByRole('link', { name: 'مهمة شخصية جديدة', exact: true }).first().click()
    await page.locator('#my-task-name').fill('مسودة لها أصل')
    if (action === 'cancel') await page.getByTestId('my-task-form-cancel').click()
    else if (action === 'escape') await page.keyboard.press('Escape')
    else if (action === 'navigation') await page.evaluate(() => (document.querySelector('.liwan-module-rail-brand') as HTMLElement).click())
    else await page.goBack()
    const guard = page.getByTestId('unsaved-changes-dialog')
    await expect(guard).toBeVisible()
    await guard.getByRole('button', { name: 'البقاء في الصفحة', exact: true }).click()
    await expect(page.locator('#my-task-name')).toHaveValue('مسودة لها أصل')
    await expect(page).toHaveURL(/\/my-tasks\/new/)
  })
}
