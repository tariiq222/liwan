import { expect, test } from '@playwright/test'
import { MeSchema, RoleListSchema } from '@liwan/contracts'

// Real Odoo only: it creates a second account through the admin API (the mock answers 404) and signs in as that user in
// the same browser. Not in ci-mock-specs.txt, and not yet in the e2e-odoo list (it has not been run on a scratch Odoo).
test.skip(process.env.E2E_REAL_ODOO !== '1', 'Explicit isolated real Odoo acceptance only')

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login')
  await page.getByLabel('اسم المستخدم').fill(process.env.E2E_ADMIN_LOGIN ?? 'admin')
  await page.getByLabel('كلمة المرور').fill(process.env.E2E_ADMIN_PASSWORD ?? 'admin')
  const authenticated = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/login' && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'دخول', exact: true }).click()
  expect((await authenticated).status()).toBe(200)
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/)
}

test('the saved appearance belongs to the signed-in user, not the browser', async ({ page }) => {
  await login(page)
  await page.request.patch('/api/v1/me/appearance', { data: { mode: 'dark', font_size: 'large' } })
  await page.goto('/projects')
  await expect(page.locator('html')).toHaveClass(/dark/)
  await expect(page.locator('html')).toHaveCSS('font-size', '18px')
  // Create the second account while the administrator is still signed in.
  const suffix = Date.now()
  const meResponse = await page.request.get('/api/v1/me')
  expect(meResponse.status()).toBe(200)
  const me = MeSchema.parse(await meResponse.json())
  const rolesResponse = await page.request.get('/api/v1/admin/roles?type=built_in')
  expect(rolesResponse.status()).toBe(200)
  const role = RoleListSchema.parse(await rolesResponse.json()).items.find(item => item.key === 'employee')
  expect(role, 'Requires a backend with the employee role').toBeDefined()
  const employeeResponse = await page.request.post('/api/v1/hr/employees', {
    data: { name: `Appearance ${suffix}`, work_email: `appearance-${suffix}@example.test` },
  })
  expect(employeeResponse.status()).toBe(201)
  const employee = await employeeResponse.json()
  const created = await page.request.post('/api/v1/admin/employee-accounts', {
    data: { employee_id: employee.id, password: 'Appearance-Initial-123!', assignments: [{ role_id: role!.id, scope: { kind: 'company', id: me.company.id } }] },
  })
  expect(created.status(), 'Requires a backend with account creation and separate user sessions').toBe(201)
  // Another user on the same browser starts from their own (default) preference.
  await page.goto('/account/settings')
  await page.getByRole('button', { name: 'تسجيل الخروج' }).click()
  await expect(page).toHaveURL(/\/login/)
  await page.getByLabel('اسم المستخدم').fill(`appearance-${suffix}@example.test`)
  await page.getByLabel('كلمة المرور').fill('Appearance-Initial-123!')
  const authenticated = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/login' && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'دخول', exact: true }).click()
  expect((await authenticated).status()).toBe(200)
  await expect(page.locator('html')).not.toHaveClass(/dark/)
  await expect(page.locator('html')).toHaveCSS('font-size', '14px')
})

