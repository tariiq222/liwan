import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function localeSource(locale: 'ar' | 'en') {
  const path = join(import.meta.dirname, '../../../../i18n/locales', locale, 'access.json')
  expect(existsSync(path), `missing ${locale} access locale`).toBe(true)
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
}

function hasPath(value: Record<string, unknown>, path: string) {
  return path.split('.').reduce<unknown>((current, key) => (
    current && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined
  ), value) !== undefined
}

describe('access locale contract', () => {
  it('provides matching user, role, audit, and security keys in Arabic and English', () => {
    const ar = localeSource('ar')
    const en = localeSource('en')
    const required = [
      'access.users', 'access.roles', 'access.audit', 'access.users.grantAccount', 'access.users.editAccess', 'access.users.resetPassword',
      'access.users.disable', 'access.users.reactivate', 'access.protected', 'access.readOnly', 'access.errors.conflict',
      'access.roles.disabledExistingAssignments',
    ]
    for (const path of required) {
      expect(hasPath(ar, path), `Arabic access locale missing ${path}`).toBe(true)
      expect(hasPath(en, path), `English access locale missing ${path}`).toBe(true)
    }
  })

  it('selects the active locale with Arabic fallback in access role surfaces', () => {
    const sources = [
      join(import.meta.dirname, '../roles/RoleTable.vue'),
      join(import.meta.dirname, '../users/UserTable.vue'),
      join(import.meta.dirname, '../users/UserAccessForm.vue'),
      join(import.meta.dirname, '../../../pages/settings/users/index.vue'),
      join(import.meta.dirname, '../../../pages/settings/roles/index.vue'),
      join(import.meta.dirname, '../../../pages/settings/roles/[roleId]/index.vue'),
      join(import.meta.dirname, '../../../pages/settings/access-log/index.vue'),
    ].map((path) => readFileSync(path, 'utf8')).join('\n')
    expect(sources).toContain("locale.value === 'ar' ? 'ar' : 'en'")
    expect(sources).toContain("?? role.name.ar")
  })
})
