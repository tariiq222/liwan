import { expect, test } from '@playwright/test'
import { AUDIT, AUDIT_DETAIL, CATALOG, ROLES, ROLE_DETAIL, USERS, USER_DETAIL, loginAdmin, mockAdminApi, openClientSide } from './support/tasmim6d'

test.describe('Plan 6d: the admin fixtures', () => {
  test('every fixture satisfies its wire contract and the ids line up', () => {
    expect(USERS.items.map(user => user.id)).toEqual([11, 12, 13])
    expect(ROLES.items.map(role => role.id)).toEqual([1, 2, 3])
    expect(USER_DETAIL.id).toBe(USERS.items[0]!.id)
    expect(ROLE_DETAIL.id).toBe(3)
    expect(AUDIT.items.map(event => event.id)).toEqual([31, 32, 33])
    expect(AUDIT_DETAIL.id).toBe(31)
    expect(CATALOG.items.length).toBeGreaterThan(1)
  })

  test('mockAdminApi answers lists, records, the q filter and 404', async ({ page }) => {
    await loginAdmin(page)
    await mockAdminApi(page)
    await openClientSide(page, '/projects')
    const get = (path: string) => page.evaluate(async (target) => {
      const response = await fetch(target)
      return { status: response.status, body: await response.json() }
    }, path)
    expect((await get('/api/v1/admin/users')).body.total).toBe(3)
    expect((await get('/api/v1/admin/users?q=sara')).body.items.map((user: { id: number }) => user.id)).toEqual([11])
    expect((await get('/api/v1/admin/users/11')).body.allowed_actions).toContain('reset_password')
    expect((await get('/api/v1/admin/users/999')).status).toBe(404)
    expect((await get('/api/v1/admin/roles/3')).body.allowed_actions).toContain('delete')
    expect((await get('/api/v1/admin/access-log?limit=25')).body.total).toBe(3)
    expect((await get('/api/v1/admin/access-log/31')).body.id).toBe(31)
    expect((await get('/api/v1/admin/permissions')).body.items.length).toBeGreaterThan(1)
  })
})
