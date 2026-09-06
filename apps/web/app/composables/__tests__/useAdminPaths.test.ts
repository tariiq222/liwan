import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { adminAuditListQuery } from '../useAdminAudit'
import { adminRoleListQuery } from '../useAdminRoles'
import { adminUserCandidateQuery, adminUserListQuery } from '../useAdminUsers'

function adminComposableSources() {
  const directory = join(import.meta.dirname, '..')
  return readdirSync(directory)
    .filter((name) => /^useAdmin.*\.ts$/.test(name))
    .map((name) => ({ name, source: readFileSync(join(directory, name), 'utf8') }))
}

function combinedSource() {
  const files = adminComposableSources()
  expect(files.length, 'the admin composable data layer is not present yet').toBeGreaterThan(0)
  return files.map(({ source }) => source).join('\n')
}

describe('admin composable request and response contracts', () => {
  it('serializes only supported filters and caps list pages at 200', () => {
    expect(adminUserListQuery({ q: '  Sara  ', status: 'stopped', role_id: 4, department_id: 3, limit: 999, offset: -2 })).toEqual({ q: 'Sara', status: 'stopped', role_id: 4, department_id: 3, limit: 200, offset: 0 })
    expect(adminUserCandidateQuery({ q: '  sara@example.com ', limit: 500, offset: 3 })).toEqual({ q: 'sara@example.com', limit: 200, offset: 3 })
    expect(adminUserCandidateQuery({ employee_id: 18, limit: 25, offset: 0 })).toEqual({ q: undefined, employee_id: 18, limit: 25, offset: 0 })
    expect(adminRoleListQuery({ q: '', type: 'custom', status: 'disabled', limit: 50, offset: 10 })).toEqual({ q: undefined, type: 'custom', status: 'disabled', limit: 50, offset: 10 })
    expect(adminAuditListQuery({ target_type: 'role', target_id: 12, action: 'role.updated', limit: 500 })).toEqual({ from: undefined, to: undefined, actor_id: undefined, target_type: 'role', target_id: 12, action: 'role.updated', limit: 200, offset: 0 })
  })

  it('declares access query keys and validates every server response', () => {
    const source = combinedSource()
    expect(source).toMatch(/\[['"]access['"]/) 
    expect(source).toContain('useApi()')
    expect(source).toContain('AdminUserListSchema')
    expect(source).toContain('AdminUserCandidateListSchema')
    expect(source).toContain('AdminUserDetailSchema')
    expect(source).toContain('RoleListSchema')
    expect(source).toContain('RoleDetailSchema')
    expect(source).toContain('AccessAuditListSchema')
    expect(source).toContain('AccessAuditDetailSchema')
  })

  it('uses the frozen users, roles, and access-log endpoints with server-supported filters', () => {
    const source = combinedSource()
    expect(source).toContain('/api/v1/admin/users')
    expect(source).toContain('/api/v1/admin/users/candidates')
    expect(source).toContain('/api/v1/admin/roles')
    expect(source).toContain('/api/v1/admin/permissions')
    expect(source).toContain('/api/v1/admin/access-log')
    for (const filter of ['q', 'role_id', 'status', 'department_id', 'type', 'from', 'to', 'actor_id', 'target_type', 'target_id', 'action', 'limit', 'offset']) {
      expect(source, `missing serialized filter ${filter}`).toContain(filter)
    }
  })

  it('keeps sensitive writes explicit, versioned, and non-optimistic', () => {
    const source = combinedSource()
    for (const method of ['POST', 'PATCH']) expect(source).toContain(`method: '${method}'`)
    expect(source).toContain('expected_version')
    expect(source).toContain('GrantAccountInputSchema')
    expect(source).toContain('UpdateUserAccessInputSchema')
    expect(source).toContain('ResetPasswordInputSchema')
    expect(source).toContain('ChangeUserStateInputSchema')
    expect(source).toContain("refreshNuxtData('me')")
    expect(source).toContain('refreshMeInNuxtContext')
    expect(source).toContain('tryUseNuxtApp()')
    expect(source).not.toMatch(/invalidateQueries\(\{\s*queryKey:\s*\[['"]me['"]\]/)
    expect(source).toContain("['access', 'audit']")
    expect(source).toContain("['people']")
    expect(source).toContain("['hr', 'employees']")
  })

  it('does not put password values in endpoint paths or query parameters', () => {
    const source = combinedSource()
    expect(source).not.toMatch(/\/api\/v1\/admin\/[^'"`]*password=/)
    expect(source).not.toMatch(/query:\s*\{[^}]*password/)
  })
})
