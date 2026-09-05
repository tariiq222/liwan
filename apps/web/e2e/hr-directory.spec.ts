import { test, expect } from '@playwright/test'

async function login(page) {
  await page.goto('/login')
  await page.getByLabel('اسم المستخدم').fill('admin')
  await page.getByLabel('كلمة المرور').fill('admin')
  await page.getByRole('button', { name: 'دخول' }).click()
  await expect(page).toHaveURL(/\/tasks$/)
}

test('HR routes create, edit, reload, and archive an employee', async ({ page }) => {
  await login(page)

  const employeeName = `E2E employee ${Date.now()}`
  await page.goto('/hr/employees/new')
  await expect(page.getByRole('heading', { name: 'موظف جديد' })).toBeVisible()
  await page.getByLabel('الاسم').fill(employeeName)
  await page.getByLabel('البريد الوظيفي').fill(`e2e-${Date.now()}@example.com`)
  await page.getByRole('button', { name: 'حفظ' }).click()
  await expect(page).toHaveURL(/\/hr\/employees\/\d+(?:\?|$)/)
  await expect(page.getByText(employeeName).first()).toBeVisible()

  const employeeId = Number(new URL(page.url()).pathname.split('/').at(-1))
  expect(employeeId).toBeGreaterThan(0)
  await page.goto(`/hr/employees/${employeeId}/edit`)
  await page.getByLabel('المسمى الوظيفي').fill('E2E coordinator')
  await page.getByRole('button', { name: 'حفظ' }).click()
  await expect(page).toHaveURL(new RegExp(`/hr/employees/${employeeId}(?:\\?|$)`))
  await page.goto(`/hr/employees/${employeeId}/edit`)
  await page.reload()
  await expect(page.getByLabel('المسمى الوظيفي')).toHaveValue('E2E coordinator')

  await page.goto('/hr')
  await page.getByPlaceholder('بحث بالاسم…').fill(employeeName)
  await page.getByRole('row', { name: new RegExp(employeeName) }).click()
  await expect(page).toHaveURL(new RegExp(`/hr/employees/${employeeId}(?:\\?|$)`))
  await page.getByRole('button', { name: 'أرشفة الموظف' }).first().click()
  await page.getByRole('button', { name: 'أرشفة الموظف' }).last().click()

  await expect.poll(async () => (await (await page.request.get(`/api/v1/hr/employees/${employeeId}`)).json()).active).toBe(false)
  await page.goto('/hr')
  await page.getByRole('button', { name: 'عرض المؤرشفين' }).click()
  await page.getByPlaceholder('بحث بالاسم…').fill(employeeName)
  await expect(page.getByRole('row', { name: new RegExp(employeeName) })).toBeVisible()
  const archived = await (await page.request.get(`/api/v1/hr/employees/${employeeId}`)).json()
  expect(archived.active).toBe(false)
})

test('HR department route creates, edits, and reloads a department', async ({ page }) => {
  await login(page)

  const departmentName = `E2E department ${Date.now()}`
  const editedName = `${departmentName} edited`
  await page.goto('/hr/departments/new')
  await expect(page.getByRole('heading', { name: 'قسم جديد' })).toBeVisible()
  await page.getByLabel('الاسم').fill(departmentName)
  await page.getByRole('button', { name: 'حفظ' }).click()
  await expect(page).toHaveURL(/\/hr\/departments\/\d+(?:\?|$)/)
  await expect(page.getByText(departmentName).first()).toBeVisible()

  const departmentId = Number(new URL(page.url()).pathname.split('/').at(-1))
  expect(departmentId).toBeGreaterThan(0)
  await page.goto(`/hr/departments/${departmentId}/edit`)
  await page.getByLabel('الاسم').fill(editedName)
  await page.getByRole('button', { name: 'حفظ' }).click()
  await expect(page).toHaveURL(new RegExp(`/hr/departments/${departmentId}(?:\\?|$)`))
  await page.reload()
  await expect(page.getByRole('heading', { name: editedName, exact: true })).toBeVisible()
})
