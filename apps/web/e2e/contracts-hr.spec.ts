import { test, expect } from '@playwright/test'
import {
  HrDepartmentSchema,
  HrDepartmentListSchema,
  HrEmployeeSchema,
  HrEmployeeListSchema,
  PersonRefSchema,
  MeSchema, RoleListSchema, AdminUserDetailSchema,
} from '@webvue/contracts'

const ADMIN_LOGIN = process.env.E2E_ADMIN_LOGIN ?? 'admin'
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'admin'

// The zod schemas and the Odoo serializers are written independently; only a
// round trip against the live API proves they still describe the same payload.
test('GET /api/v1/hr list endpoints match their schemas; people picker stays PersonRef', async ({ page }) => {
  const login = await page.request.post('/api/auth/login', { data: { login: ADMIN_LOGIN, password: ADMIN_PASSWORD } })
  expect(login.status()).toBe(200)

  const deptsRes = await page.request.get('/api/v1/hr/departments')
  expect(deptsRes.status()).toBe(200)
  HrDepartmentListSchema.parse(await deptsRes.json())

  const empsRes = await page.request.get('/api/v1/hr/employees')
  expect(empsRes.status()).toBe(200)
  HrEmployeeListSchema.parse(await empsRes.json())

  // Picker ids are res.users ids (PersonRef.id === user_id), not hr.employee ids.
  const peopleRes = await page.request.get('/api/v1/people?q=')
  expect(peopleRes.status()).toBe(200)
  const people = PersonRefSchema.array().parse(await peopleRes.json())
  for (const person of people) {
    expect(person.id).toBe(person.user_id)
  }
})

test('HR mutation responses match schemas and PMO people refs use the linked user id', async ({ page }) => {
  const login = await page.request.post('/api/auth/login', { data: { login: ADMIN_LOGIN, password: ADMIN_PASSWORD } })
  expect(login.status()).toBe(200)

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const departmentRes = await page.request.post('/api/v1/hr/departments', {
    data: { name: `E2E contract HR ${suffix}` },
  })
  expect(departmentRes.status()).toBe(201)
  const department = HrDepartmentSchema.parse(await departmentRes.json())

  const departmentPatchRes = await page.request.patch(`/api/v1/hr/departments/${department.id}`, {
    data: { name: `E2E contract HR patched ${suffix}` },
  })
  expect(departmentPatchRes.status()).toBe(200)
  HrDepartmentSchema.parse(await departmentPatchRes.json())

  const employeeRes = await page.request.post('/api/v1/hr/employees', {
    data: {
      name: `E2E contract employee ${suffix}`,
      work_email: `e2e-contract-${suffix}@example.test`,
      department_id: department.id,
      job_title: 'Contract fixture',
    },
  })
  expect(employeeRes.status()).toBe(201)
  const employee = HrEmployeeSchema.parse(await employeeRes.json())

  const employeePatchRes = await page.request.patch(`/api/v1/hr/employees/${employee.id}`, {
    data: { job_title: 'Patched contract fixture', work_phone: '+966500000000' },
  })
  expect(employeePatchRes.status()).toBe(200)
  HrEmployeeSchema.parse(await employeePatchRes.json())

  const archiveRes = await page.request.post(`/api/v1/hr/employees/${employee.id}/archive`, { data: {} })
  expect(archiveRes.status()).toBe(200)
  HrEmployeeSchema.parse(await archiveRes.json())
  const unarchiveRes = await page.request.post(`/api/v1/hr/employees/${employee.id}/unarchive`, { data: {} })
  expect(unarchiveRes.status()).toBe(200)
  HrEmployeeSchema.parse(await unarchiveRes.json())

  const me = MeSchema.parse(await (await page.request.get('/api/v1/me')).json())
  const roles = RoleListSchema.parse(await (await page.request.get('/api/v1/admin/roles')).json())
  const employeeRole = roles.items.find(role => role.key === 'employee')!
  const assignments = [{ role_id: employeeRole.id, scope: { kind: 'company', id: me.company.id } }]
  const accessRes = await page.request.post('/api/v1/admin/employee-accounts', {
    data: { employee_id: employee.id, password: `E2E-contract-${suffix}`, assignments },
  })
  expect(accessRes.status()).toBe(201)
  const account = AdminUserDetailSchema.parse(await accessRes.json())
  const linkedEmployee = HrEmployeeSchema.parse(await (await page.request.get(`/api/v1/hr/employees/${employee.id}`)).json())
  expect(linkedEmployee.access?.user_id).toBe(account.id)
  expect(account.employee?.id).toBe(employee.id)

  const peopleRes = await page.request.get(`/api/v1/people?q=${encodeURIComponent(linkedEmployee.name)}`)
  expect(peopleRes.status()).toBe(200)
  const matchingPeople = PersonRefSchema.array().parse(await peopleRes.json())
  expect(matchingPeople).toContainEqual(expect.objectContaining({ id: account.id, user_id: account.id }))

  const accessPatchRes = await page.request.patch(`/api/v1/admin/users/${account.id}/access`, {
    data: { assignments, expected_version: account.version },
  })
  expect(accessPatchRes.status()).toBe(200)
  const updated = AdminUserDetailSchema.parse(await accessPatchRes.json())
  const disableRes = await page.request.post(`/api/v1/admin/users/${account.id}/disable`, {
    data: { expected_version: updated.version },
  })
  expect(disableRes.status()).toBe(200)
  expect(AdminUserDetailSchema.parse(await disableRes.json()).active).toBe(false)

  const emptyDepartmentRes = await page.request.post('/api/v1/hr/departments', {
    data: { name: `E2E contract empty HR ${suffix}` },
  })
  expect(emptyDepartmentRes.status()).toBe(201)
  const emptyDepartment = HrDepartmentSchema.parse(await emptyDepartmentRes.json())
  const departmentDeleteRes = await page.request.delete(`/api/v1/hr/departments/${emptyDepartment.id}`)
  expect(departmentDeleteRes.status()).toBe(204)
})
