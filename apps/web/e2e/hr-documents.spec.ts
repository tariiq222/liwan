import { test, expect } from '@playwright/test'

const ADMIN_LOGIN = process.env.E2E_ADMIN_LOGIN ?? 'admin'
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'admin'

async function login(page) {
  await page.goto('/login')
  await page.getByLabel('اسم المستخدم').fill(ADMIN_LOGIN)
  await page.getByLabel('كلمة المرور').fill(ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'دخول' }).click()
  await expect(page).toHaveURL(/\/tasks$/)
}

// Employee users are created through Odoo (or the API), never the Nuxt UI.
// Reading another department's document / hidden editor for employees needs
// an Odoo-created nasq_core.group_employee user and is not exercised here.

test('admin selects a department, creates a document, searches by name, and opens it', async ({ page }) => {
  await login(page)

  const deptName = `E2E docs ${Date.now()}`
  const createdDept = await page.request.post('/api/v1/hr/departments', { data: { name: deptName } })
  expect(createdDept.status()).toBe(201)

  const title = `E2E doc ${Date.now()}`
  const body = `E2E body ${Date.now()}`

  await page.goto('/hr')
  await expect(page.getByRole('heading', { name: 'الأشخاص' })).toBeVisible()

  await page.getByRole('tab', { name: 'الأقسام' }).click()
  await page.getByTestId('hr-department-table').getByRole('button', { name: new RegExp(deptName) }).click()

  await expect(page.getByRole('heading', { name: 'المستندات' })).toBeVisible()
  await page.getByRole('button', { name: 'مستند جديد' }).first().click()

  const createDialog = page.getByRole('dialog', { name: 'مستند جديد' })
  await expect(createDialog).toBeVisible()
  await createDialog.getByLabel('عنوان المستند').fill(title)
  await createDialog.getByRole('button', { name: 'إنشاء' }).click()

  const sheet = page.getByRole('dialog')
  await expect(sheet.getByRole('heading', { name: title })).toBeVisible()
  const editor = sheet.getByRole('textbox', { name: 'المحتوى' })
  await editor.click()
  await editor.type(body)
  await page.waitForTimeout(1200)
  await expect(sheet.getByText('الوسوم')).toHaveCount(0)

  const filename = `e2e-att-${Date.now()}.txt`
  await sheet.getByLabel('رفع ملف').setInputFiles({
    name: filename,
    mimeType: 'text/plain',
    buffer: Buffer.from('hello nasq'),
  })
  await expect(sheet.getByRole('link', { name: filename })).toBeVisible()
  await expect(page).toHaveURL(/\/hr/)
  await expect(page).not.toHaveURL(/\/people/)

  await page.keyboard.press('Escape')

  await page.getByPlaceholder('بحث بالعنوان…').fill('zzz-no-such-document')
  await expect(page.getByText('لا مستندات')).toBeVisible()

  await page.getByPlaceholder('بحث بالعنوان…').fill(title)
  const row = page.getByRole('row', { name: new RegExp(title) })
  await expect(row).toBeVisible()
  await row.click()
  await expect(page.getByRole('dialog').getByRole('heading', { name: title })).toBeVisible()
  await expect(page.getByRole('dialog').getByRole('textbox', { name: 'المحتوى' })).toContainText(body)
  await expect(page.getByRole('dialog').getByRole('link', { name: filename })).toBeVisible()
  await expect(page.getByRole('dialog').getByText('الوسوم')).toHaveCount(0)
  await expect(page).toHaveURL(/\/hr/)
  await expect(page).not.toHaveURL(/\/people/)
})
