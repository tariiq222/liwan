import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { builtinRoleDescription, permissionDomainLabel } from '../labelFallback'

const app = resolve(import.meta.dirname, '../..')

function catalogue(locale: 'ar' | 'en') {
  const messages = JSON.parse(readFileSync(resolve(app, `../i18n/locales/${locale}/access.json`), 'utf8'))
  const lookup = (key: string) => key.split('.').reduce<unknown>((value, part) => (value as Record<string, unknown> | undefined)?.[part], messages)
  return {
    messages,
    domains: messages.access.roles.domains as Record<string, string>,
    descriptions: messages.access.roles.descriptions as Record<string, string>,
    t: (key: string) => (typeof lookup(key) === 'string' ? lookup(key) as string : key),
    te: (key: string) => typeof lookup(key) === 'string',
  }
}

describe('label fallbacks for applications that ship no label', () => {
  it("keeps today's domain labels and never shows an i18n key for a new domain", () => {
    for (const locale of ['ar', 'en'] as const) {
      const { domains, t, te } = catalogue(locale)
      for (const domain of ['access', 'hr', 'pmo', 'meetings', 'settings']) {
        expect(permissionDomainLabel(domain, t, te)).toBe(domains[domain])
      }
      expect(permissionDomainLabel('sales', t, te)).toBe('Sales')
    }
  })

  it('routes both role screens through the fallback', () => {
    for (const file of ['components/access/roles/RolePermissionForm.vue', 'pages/settings/roles/new.vue']) {
      const source = readFileSync(resolve(app, file), 'utf8')
      expect(source, file).toContain('permissionDomainLabel(')
      expect(source, file).not.toContain('access.roles.domains.${')
    }
  })
})

describe('built-in role descriptions on /settings/roles', () => {
  const BUILT_INS = ['employee', 'system_admin', 'vendor_support', 'pmo_manager', 'hr_manager'] as const
  // The unlocalized seed text the addons store for these roles (nasq_core/nasq_pmo/nasq_hr data).
  const SEED = { employee: 'Employee', system_admin: 'System administrator', vendor_support: 'Vendor support', pmo_manager: 'PMO manager', hr_manager: 'HR manager' } as const

  it('shows the localized purpose, not the stored seed text, for every shipped built-in role', () => {
    for (const locale of ['ar', 'en'] as const) {
      const { descriptions, t, te } = catalogue(locale)
      for (const key of BUILT_INS) {
        expect(builtinRoleDescription({ type: 'built_in', key, description: SEED[key] }, t, te), `${locale}/${key}`).toBe(descriptions[key])
        expect(descriptions[key], `${locale}/${key} must not restate the role name`).not.toBe(SEED[key])
      }
    }
  })

  it('shows the stored description for custom roles and unknown built-ins', () => {
    for (const locale of ['ar', 'en'] as const) {
      const { t, te } = catalogue(locale)
      expect(builtinRoleDescription({ type: 'custom', key: 'custom_x', description: 'Private role' }, t, te)).toBe('Private role')
      expect(builtinRoleDescription({ type: 'built_in', key: 'future_role', description: 'Future seed text' }, t, te)).toBe('Future seed text')
    }
  })

  it('routes the role table and the readonly role form through the localized description', () => {
    const table = readFileSync(resolve(app, 'components/access/roles/RoleTable.vue'), 'utf8')
    expect(table).toContain('builtinRoleDescription(')
    expect(table).not.toContain('row.original.description')
    const form = readFileSync(resolve(app, 'components/access/roles/RolePermissionForm.vue'), 'utf8')
    expect(form).toContain('builtinRoleDescription(')
  })
})
