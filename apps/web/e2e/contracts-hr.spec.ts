import { test, expect } from '@playwright/test'
import {
  HrDepartmentListSchema,
  HrDocumentListSchema,
  HrEmployeeListSchema,
  PersonRefSchema,
} from '@nasq/contracts'

// The zod schemas and the Odoo serializers are written independently; only a
// round trip against the live API proves they still describe the same payload.
test('GET /api/v1/hr list endpoints match their schemas; people picker stays PersonRef', async ({ page }) => {
  const login = await page.request.post('/api/auth/login', { data: { login: 'admin', password: 'admin' } })
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
