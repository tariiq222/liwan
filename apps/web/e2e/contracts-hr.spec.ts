import { test, expect } from '@playwright/test'
import {
  HrDepartmentSchema,
  HrDepartmentListSchema,
  HrDocumentSchema,
  HrDocumentListSchema,
  HrEmployeeSchema,
  HrEmployeeListSchema,
  PersonRefSchema,
} from '@nasq/contracts'

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

  const docsRes = await page.request.get('/api/v1/hr/documents')
  expect(docsRes.status()).toBe(200)
  HrDocumentListSchema.parse(await docsRes.json())

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

  // Deliberately prove that the HR record id and the linked res.users id are
  // distinct before checking the PMO picker contract.
  const accessRes = await page.request.post(`/api/v1/hr/employees/${employee.id}/access`, {
    data: { password: `E2E-contract-${suffix}`, role: 'employee' },
  })
  expect(accessRes.status()).toBe(200)
  const linkedEmployee = HrEmployeeSchema.parse(await accessRes.json())
  expect(linkedEmployee.access).not.toBeNull()
  expect(linkedEmployee.access!.user_id).not.toBe(linkedEmployee.id)

  const peopleRes = await page.request.get(`/api/v1/people?q=${encodeURIComponent(linkedEmployee.name)}`)
  expect(peopleRes.status()).toBe(200)
  const matchingPeople = PersonRefSchema.array().parse(await peopleRes.json())
  expect(matchingPeople).toContainEqual(expect.objectContaining({
    id: linkedEmployee.access!.user_id,
    user_id: linkedEmployee.access!.user_id,
  }))

  const accessPatchRes = await page.request.patch(`/api/v1/hr/employees/${employee.id}/access`, {
    data: { role: 'admin' },
  })
  expect(accessPatchRes.status()).toBe(200)
  HrEmployeeSchema.parse(await accessPatchRes.json())
  const accessDeleteRes = await page.request.delete(`/api/v1/hr/employees/${employee.id}/access`)
  expect(accessDeleteRes.status()).toBe(200)
  HrEmployeeSchema.parse(await accessDeleteRes.json())

  const documentRes = await page.request.post('/api/v1/hr/documents', {
    data: { name: `E2E contract document ${suffix}`, body: 'contract body', department_id: department.id },
  })
  expect(documentRes.status()).toBe(201)
  const document = HrDocumentSchema.parse(await documentRes.json())
  const documentPatchRes = await page.request.patch(`/api/v1/hr/documents/${document.id}`, {
    data: { name: `E2E contract document patched ${suffix}` },
  })
  expect(documentPatchRes.status()).toBe(200)
  HrDocumentSchema.parse(await documentPatchRes.json())
  const attachmentRes = await page.request.post(`/api/v1/hr/documents/${document.id}/attachments`, {
    data: {
      name: `contract-${suffix}.txt`,
      datas: Buffer.from('contract attachment').toString('base64'),
      mimetype: 'text/plain',
    },
  })
  expect(attachmentRes.status()).toBe(200)
  HrDocumentSchema.parse(await attachmentRes.json())

  const emptyDepartmentRes = await page.request.post('/api/v1/hr/departments', {
    data: { name: `E2E contract empty HR ${suffix}` },
  })
  expect(emptyDepartmentRes.status()).toBe(201)
  const emptyDepartment = HrDepartmentSchema.parse(await emptyDepartmentRes.json())
  const departmentDeleteRes = await page.request.delete(`/api/v1/hr/departments/${emptyDepartment.id}`)
  expect(departmentDeleteRes.status()).toBe(204)
})
