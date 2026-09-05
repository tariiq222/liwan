import { test, expect } from '@playwright/test'
import { AdminUserDetailSchema, HrEmployeeSchema, MeSchema, RoleListSchema } from '@nasq/contracts'

test('HR archival disables linked access and unarchival requires explicit account reactivation', async ({ page, browser }) => {
  expect((await page.request.post('/api/auth/login', { data: { login: 'admin', password: 'admin' } })).status()).toBe(200)
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const email = `hr-lifecycle-${suffix}@example.test`
  const password = `Nasq-lifecycle-${suffix}`
  const employeeRes = await page.request.post('/api/v1/hr/employees', { data: { name: `موظف دورة ${suffix}`, work_email: email } })
  expect(employeeRes.status()).toBe(201)
  const employee = HrEmployeeSchema.parse(await employeeRes.json())
  const me = MeSchema.parse(await (await page.request.get('/api/v1/me')).json())
  const roles = RoleListSchema.parse(await (await page.request.get('/api/v1/admin/roles')).json())
  const role = roles.items.find(item => item.key === 'employee')!
  const grant = await page.request.post('/api/v1/admin/users', { data: { employee_id: employee.id, password, assignments: [{ role_id: role.id, scope: { kind: 'company', id: me.company.id } }] } })
  expect(grant.status()).toBe(201)
  const account = AdminUserDetailSchema.parse(await grant.json())
  const employeeContext = await browser.newContext({ baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000' })
  try {
    expect((await employeeContext.request.post('/api/auth/login', { data: { login: email, password } })).status()).toBe(200)
    expect(MeSchema.parse(await (await employeeContext.request.get('/api/v1/me')).json()).id).toBe(account.id)
    const changed = await page.request.patch(`/api/v1/hr/employees/${employee.id}`, { data: { work_email: `changed-${email}` } })
    expect(changed.status()).toBe(200)
    expect(AdminUserDetailSchema.parse(await (await page.request.get(`/api/v1/admin/users/${account.id}`)).json()).login).toBe(email)
    await page.goto(`/hr/employees/${employee.id}`)
    await page.getByRole('button', { name: 'أرشفة الموظف', exact: true }).first().click()
    await page.getByRole('button', { name: 'أرشفة الموظف', exact: true }).last().click()
    await expect.poll(async () => HrEmployeeSchema.parse(await (await page.request.get(`/api/v1/hr/employees/${employee.id}`)).json()).active).toBe(false)
    const archived = HrEmployeeSchema.parse(await (await page.request.get(`/api/v1/hr/employees/${employee.id}`)).json())
    expect(archived.access).toMatchObject({ user_id: account.id, active: false })
    expect((await employeeContext.request.get('/api/v1/me')).status()).toBe(403)
    const unarchive = await page.request.post(`/api/v1/hr/employees/${employee.id}/unarchive`, { data: {} })
    expect(unarchive.status()).toBe(200)
    expect(HrEmployeeSchema.parse(await unarchive.json())).toMatchObject({ active: true, access: { active: false } })
    const disabled = AdminUserDetailSchema.parse(await (await page.request.get(`/api/v1/admin/users/${account.id}`)).json())
    const reactivate = await page.request.post(`/api/v1/admin/users/${account.id}/reactivate`, { data: { expected_version: disabled.version, password } })
    expect(reactivate.status()).toBe(200)
    expect(AdminUserDetailSchema.parse(await reactivate.json()).active).toBe(true)
    expect((await employeeContext.request.get('/api/v1/me')).status()).toBe(403)
    expect((await employeeContext.request.post('/api/auth/login', { data: { login: email, password } })).status()).toBe(200)
    expect(MeSchema.parse(await (await employeeContext.request.get('/api/v1/me')).json()).id).toBe(account.id)
    await expect(page.getByRole('dialog')).toHaveCount(0)
  } finally { await employeeContext.close() }
})
