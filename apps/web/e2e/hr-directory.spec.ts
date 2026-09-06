import { test, expect } from '@playwright/test'

async function login(page) {
  await page.goto('/login')
  await page.getByLabel('اسم المستخدم').fill('admin')
  await page.getByLabel('كلمة المرور').fill('admin')
  await page.getByRole('button', { name: 'دخول' }).click()
  await expect(page).toHaveURL(/\/tasks$/)
}

test('HR employee creation Cancel returns to the filtered directory', async ({ page }) => {
  await login(page)

  const returnTo = '/hr?q=cancel-filter'
  await page.goto(`/hr/employees/new?returnTo=${encodeURIComponent(returnTo)}`)
  await expect(page.getByRole('heading', { name: 'موظف جديد' })).toBeVisible()
  await page.getByRole('button', { name: 'إلغاء' }).click()
  await expect(page).toHaveURL(/\/hr\?q=cancel-filter$/)
})

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

test('HR directory shows a translated error and retry instead of an empty list', async ({ page }) => {
  await login(page)
  let fail = true
  await page.route('**/api/v1/hr/employees**', async (route) => {
    if (route.request().method() !== 'GET' || !fail) {
      await route.continue()
      return
    }
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'unavailable', message: 'temporarily unavailable' }),
    })
  })
  await page.goto('/hr')
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByRole('button', { name: 'إعادة المحاولة' })).toBeVisible()
  await expect(page.getByText('لا موظفون بعد')).toHaveCount(0)
  fail = false
  await page.getByRole('button', { name: 'إعادة المحاولة' }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('HR employee names are real links that preserve filters; actions do not steal navigation', async ({ page }) => {
  await login(page)
  const employeeName = `E2E link ${Date.now()}`
  const employee = await (await page.request.post('/api/v1/hr/employees', {
    data: { name: employeeName, work_email: `e2e-link-${Date.now()}@example.com` },
  })).json()
  await page.goto(`/hr?q=${encodeURIComponent(employeeName)}`)
  const nameLink = page.getByTestId('hr-employee-name').filter({ hasText: employeeName })
  await expect(nameLink).toBeVisible()
  await expect(nameLink).toHaveAttribute('href', new RegExp(`/hr/employees/${employee.id}\\?returnTo=`))
  await nameLink.focus()
  await expect(nameLink).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(new RegExp(`/hr/employees/${employee.id}(?:\\?|$)`))

  await page.goto(`/hr?q=${encodeURIComponent(employeeName)}`)
  await page.getByTestId('hr-employee-manage').click()
  await expect(page).toHaveURL(new RegExp(`/hr/employees/${employee.id}/edit(?:\\?|$)`))
  await expect(page.locator('[data-slot="dialog-content"], [data-slot="sheet-content"]').first()).toHaveCount(0)
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
