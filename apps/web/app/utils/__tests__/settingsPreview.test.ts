import { describe, expect, it } from 'vitest'
import type { AccessAuditSummary, AdminUserSummary, RoleSummary } from '@liwan/contracts'
import { eventPreview, rolePreview, userPreview } from '../settingsPreview'

const labels = { t: (key: string) => (key === 'app.listSeparator' ? '، ' : key), te: () => false, locale: 'ar' }
const name = (ar: string) => ({ ar, en: null })

describe('settings preview rows', () => {
  it('a user is a name, one muted line of login and roles, and one state pill', () => {
    const user = { id: 4, name: 'سارة', login: 'sara', active: true, protected: false, assignments: [{ id: 1, role: { name: name('مدير') } }, { id: 2, role: { name: name('مراجع') } }] } as unknown as AdminUserSummary
    const row = userPreview(user, labels)
    expect(row).toMatchObject({ id: 4, to: '/settings/team/users/4', name: 'سارة', person: { id: 4, name: 'سارة' }, secondary: 'sara · مدير، مراجع' })
    expect(row.badge?.label).toBeTruthy()
    expect(userPreview({ ...user, assignments: [] } as AdminUserSummary, labels).secondary).toBe('sara · access.users.noRoles')
  })

  it('a role shows its description and user count on one line', () => {
    const role = { id: 3, key: 'custom', type: 'custom', name: name('مراجع'), description: 'يقرأ فقط', active: true, protected: false, user_count: 5 } as unknown as RoleSummary
    expect(rolePreview(role, labels)).toMatchObject({ to: '/settings/team/roles/3', name: 'مراجع', icon: 'i-lucide-shield-check', secondary: 'يقرأ فقط · access.roles.columns.users: 5' })
  })

  it('an access-log event is its action over target, actor and time', () => {
    const event = { id: 9, action: 'role.created', actor: null, target: { name: 'مراجع' }, occurred_at: '2030-01-15T10:30:00Z' } as unknown as AccessAuditSummary
    const row = eventPreview(event, 'أُنشئ دور', labels)
    expect(row).toMatchObject({ to: '/settings/team/access-log/9', name: 'أُنشئ دور', badge: { tone: 'success' } })
    expect(row.secondary?.startsWith('مراجع · access.audit.system · ')).toBe(true)
  })
})
