import { test, expect } from '@playwright/test'

async function login(page) {
  await page.goto('/login')
  await page.getByLabel('اسم المستخدم').fill('admin')
  await page.getByLabel('كلمة المرور').fill('admin')
  await page.getByRole('button', { name: 'دخول' }).click()
  await expect(page).toHaveURL(/\/tasks$/)
}

// Employee users are created through Odoo (or the API), never the Nuxt UI.
// Checks that an employee does not see قسم جديد / مستند جديد (and gets 403 on
// writes) therefore need an Odoo-created nasq_core.group_employee user and
// are not exercised in this file.

test('admin directory: table, search, read-only card, and write actions', async ({ page }) => {
  await login(page)
  await page.goto('/hr')
  await expect(page.getByRole('heading', { name: 'الأشخاص' })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'الاسم' })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'المسمى الوظيفي' })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'القسم' })).toBeVisible()

  const employees = await (await page.request.get('/api/v1/hr/employees')).json()
  expect(employees.items.length).toBeGreaterThan(0)
  const employee = employees.items[0]

  await page.getByPlaceholder('بحث بالاسم…').fill('zzz-no-such-employee')
  await expect(page.getByText('لا موظفون بعد')).toBeVisible()

  await page.getByPlaceholder('بحث بالاسم…').fill(employee.name)
  const row = page.getByRole('row', { name: new RegExp(employee.name) })
  await expect(row).toBeVisible()
  await row.click()

  const card = page.getByRole('dialog')
  await expect(card.getByRole('heading', { name: 'بطاقة الموظف' })).toBeVisible()
  await expect(card.getByText(employee.name).first()).toBeVisible()
  await expect(card.getByRole('button', { name: 'حفظ' })).toHaveCount(0)
  await expect(card.getByRole('textbox')).toHaveCount(0)

  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'الأقسام' }).click()
  await expect(page.getByRole('button', { name: 'قسم جديد' })).toBeVisible()
  await page.keyboard.press('Escape')

  let departments = await (await page.request.get('/api/v1/hr/departments')).json()
  if (!departments.items.length) {
    const created = await page.request.post('/api/v1/hr/departments', {
      data: { name: `E2E dept ${Date.now()}` },
    })
    expect(created.status()).toBe(201)
    await page.reload()
    departments = await (await page.request.get('/api/v1/hr/departments')).json()
  }
  const dept = departments.items[0]
  await page.getByRole('combobox').filter({ hasText: 'كل الأقسام' }).click()
  await page.getByRole('option', { name: dept.name, exact: true }).click()
  await expect(page.getByRole('button', { name: 'مستند جديد' }).first()).toBeVisible()
})
