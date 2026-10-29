import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(join(import.meta.dirname, '..', '..', path), 'utf8')

describe('access settings pages', () => {
  const users = read('pages/settings/team/users/index.vue')
  it('ignores a non-numeric role or department filter in the URL', () => {
    expect(users).toContain('queryPositiveInt(route.query.role_id)')
    expect(users).toContain('queryPositiveInt(route.query.department_id)')
    expect(users).not.toContain('Number(route.query.role_id)')
  })
  it('writes the search text to the URL while typing, not only on Enter', () => {
    expect(users).toContain('watchDebounced(() => filters.q')
  })
  it('offers clone as the primary action of a role that cannot be edited', () => {
    expect(read('pages/settings/team/roles/[roleId]/index.vue')).toContain("if (can('access.roles.manage')) return {")
  })
  it('marks sensitive permissions in the role forms', () => {
    for (const file of ['components/access/roles/RolePermissionForm.vue', 'pages/settings/team/roles/new.vue']) {
      expect(read(file)).toContain('permission.sensitive')
    }
  })
})
