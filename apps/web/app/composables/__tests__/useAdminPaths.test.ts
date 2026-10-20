import { describe, expect, it } from 'vitest'
import { adminAuditListQuery } from '../useAdminAudit'
import { adminRoleListQuery } from '../useAdminRoles'
import { adminUserListQuery } from '../useAdminUsers'
import { employeeAccountCandidateQuery } from '../useEmployeeAccounts'

// The endpoints and schemas these composables use are proven live by
// e2e/contracts.spec.ts and e2e/access-admin.spec.ts; the serializers are
// pure functions, so they are proven here.
describe('admin composable request and response contracts', () => {
  it('serializes only supported filters and caps list pages at 200', () => {
    expect(adminUserListQuery({ q: '  Sara  ', status: 'stopped', role_id: 4, department_id: 3, limit: 999, offset: -2 })).toEqual({ q: 'Sara', status: 'stopped', role_id: 4, department_id: 3, limit: 200, offset: 0 })
    expect(employeeAccountCandidateQuery({ q: '  sara@example.com ', limit: 500, offset: 3 })).toEqual({ q: 'sara@example.com', limit: 200, offset: 3 })
    expect(employeeAccountCandidateQuery({ employee_id: 18, limit: 25, offset: 0 })).toEqual({ q: undefined, employee_id: 18, limit: 25, offset: 0 })
    expect(adminRoleListQuery({ q: '', type: 'custom', status: 'disabled', limit: 50, offset: 10 })).toEqual({ q: undefined, type: 'custom', status: 'disabled', limit: 50, offset: 10 })
    expect(adminAuditListQuery({})).toMatchObject({ limit: 25, offset: 0 })
    expect(adminAuditListQuery({ target_type: 'role', target_id: 12, action: 'role.updated', limit: 500 })).toEqual({ from: undefined, to: undefined, actor_id: undefined, target_type: 'role', target_id: 12, action: 'role.updated', limit: 200, offset: 0 })
  })
})
