import { describe, expect, it } from 'vitest'
import { activeNavId, adminNav, splitRail } from '../adminNav'

// The role table of the vendor admin separation spec (capabilities listed without the `vendor.` prefix).
const READ = ['read']
const ROLES: Record<string, string[]> = {
  owner: ['read', 'tenants.manage', 'subscriptions.manage', 'billing.manage', 'catalog.manage', 'pricing.manage', 'operations.run', 'audit.read', 'accounts.manage'],
  customer_success: [...READ, 'tenants.manage', 'subscriptions.manage'],
  finance: [...READ, 'billing.manage'],
  product: [...READ, 'catalog.manage', 'pricing.manage'],
  operations: [...READ, 'operations.run'],
  support: [...READ, 'audit.read'],
}
const caps = (role: string) => ROLES[role]!.map(name => `vendor.${name}`)
const ids = (capabilities: string[]) => adminNav(capabilities).map(item => item.id)

const READ_SECTIONS = ['overview', 'customers', 'tenants', 'operations', 'plans', 'bundles', 'catalog']

describe('adminNav', () => {
  it('shows the owner every section in the fixed order', () => {
    expect(ids(caps('owner'))).toEqual([...READ_SECTIONS, 'invoices', 'audit', 'team'])
  })

  it.each([
    ['customer_success', READ_SECTIONS],
    ['finance', [...READ_SECTIONS, 'invoices']],
    ['product', READ_SECTIONS],
    ['operations', READ_SECTIONS],
    ['support', [...READ_SECTIONS, 'audit']],
  ])('shows %s exactly its sections', (role, expected) => {
    expect(ids(caps(role))).toEqual(expected)
  })

  it('shows nothing without any capability', () => {
    expect(ids([])).toEqual([])
  })

  it('leaks no section when its own capability is missing', () => {
    const gated: Record<string, string> = { invoices: 'vendor.billing.manage', audit: 'vendor.audit.read', team: 'vendor.accounts.manage' }
    for (const [section, capability] of Object.entries(gated)) {
      const withoutIt = caps('owner').filter(name => name !== capability)
      expect(ids(withoutIt)).not.toContain(section)
    }
    expect(ids(caps('owner').filter(name => name !== 'vendor.read'))).toEqual(['invoices', 'audit', 'team'])
  })

  it('points every item at a root path without the old /vendor prefix', () => {
    for (const item of adminNav(caps('owner'))) {
      expect(item.to).toBe(`/${item.id}`)
      expect(item.external).toBe(false)
      expect(item.labelKey).toBe(`app.nav.${item.id}`)
      expect(item.icon).toMatch(/^i-lucide-/)
    }
  })
})

describe('activeNavId', () => {
  const items = adminNav(caps('owner'))

  it('matches the section of a list or record path', () => {
    expect(activeNavId(items, '/customers')).toBe('customers')
    expect(activeNavId(items, '/customers/12/change')).toBe('customers')
    expect(activeNavId(items, '/plans/new')).toBe('plans')
  })

  it('does not match a path that only shares a prefix', () => {
    expect(activeNavId(items, '/plansx')).toBeNull()
  })

  it('treats the root as the overview and ignores query and trailing slash', () => {
    expect(activeNavId(items, '/')).toBe('overview')
    expect(activeNavId(items, '/team/')).toBe('team')
  })

  it('returns null for a section the user cannot see', () => {
    expect(activeNavId(adminNav(caps('support')), '/invoices')).toBeNull()
  })
})

describe('splitRail', () => {
  it('keeps every item once and puts audit and team in the administration group', () => {
    const items = adminNav(caps('owner'))
    const { modules, utility } = splitRail(items)
    expect(utility.map(item => item.id)).toEqual(['audit', 'team'])
    expect([...modules, ...utility]).toHaveLength(items.length)
    expect(splitRail(adminNav(caps('finance'))).utility).toEqual([])
  })
})
