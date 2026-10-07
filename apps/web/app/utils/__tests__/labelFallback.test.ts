import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { humanizeId, permissionDomainLabel } from '../labelFallback'

const app = resolve(import.meta.dirname, '../..')

function catalogue(locale: 'ar' | 'en') {
  const messages = JSON.parse(readFileSync(resolve(app, `../i18n/locales/${locale}/access.json`), 'utf8'))
  const lookup = (key: string) => key.split('.').reduce<unknown>((value, part) => (value as Record<string, unknown> | undefined)?.[part], messages)
  return {
    domains: messages.access.roles.domains as Record<string, string>,
    t: (key: string) => (typeof lookup(key) === 'string' ? lookup(key) as string : key),
    te: (key: string) => typeof lookup(key) === 'string',
  }
}

describe('label fallbacks for applications that ship no label', () => {
  it('humanises module ids and identifiers', () => {
    expect(humanizeId('nasq_sales')).toBe('Sales')
    expect(humanizeId('customer_acme_reports')).toBe('Acme reports')
    expect(humanizeId('sales')).toBe('Sales')
    expect(humanizeId('field_service')).toBe('Field service')
    expect(humanizeId('')).toBe('')
    expect(humanizeId('nasq_')).toBe('nasq_')
    expect(humanizeId('nasq__x')).toBe('X')
    expect(humanizeId('a..b')).toBe('A b')
    expect(humanizeId('field.service')).toBe('Field service')
  })

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
