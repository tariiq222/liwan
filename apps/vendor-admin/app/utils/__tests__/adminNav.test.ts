import { describe, expect, it } from 'vitest'
import { activeNavId, adminNav, splitRail } from '../adminNav'

// The role table of the vendor admin separation spec (capabilities listed without the `vendor.` prefix).
// Mirrors ROLE_CAPABILITIES in apps/control-plane/src/admin-auth/roles.ts, which no shared contract exports;
// the app must not import the control plane, so a role change there needs this table updated by hand.
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

const BEFORE_INVOICES = ['overview', 'customers', 'catalog']
const READ_SECTIONS = [...BEFORE_INVOICES, 'operations']

describe('adminNav', () => {
  it('shows the owner every section in the fixed order', () => {
    expect(ids(caps('owner'))).toEqual([...BEFORE_INVOICES, 'invoices', 'operations', 'audit', 'team'])
  })

  it.each([
    ['customer_success', READ_SECTIONS],
    ['finance', [...BEFORE_INVOICES, 'invoices', 'operations']],
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
      expect(item.to).toBe(item.id === 'catalog' ? '/plans' : `/${item.id}`)
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
    expect(activeNavId(items, '/plans/new')).toBe('catalog')
    expect(activeNavId(items, '/team/new')).toBe('team')
  })

  it('keeps a workspace without a customer under customers, which owns the only client section', () => {
    expect(activeNavId(items, '/tenants/t-1')).toBe('customers')
    expect(activeNavId(items, '/customers/new')).toBe('customers')
    expect(activeNavId(items, '/tenantsx')).toBeNull()
    expect(items.map(item => item.id)).not.toContain('tenants')
  })

  it('keeps plans, bundles and the retired legacy packages under the catalog', () => {
    for (const path of ['/plans', '/plans/p-1/edit', '/bundles', '/bundles/new', '/catalog', '/catalog/pkg-1']) expect(activeNavId(items, path), path).toBe('catalog')
    expect(items.map(item => item.id)).not.toContain('plans')
    expect(items.map(item => item.id)).not.toContain('bundles')
    expect(activeNavId(items, '/catalogx')).toBeNull()
  })

  it('does not match a path that only shares a prefix', () => {
    expect(activeNavId(items, '/plansx')).toBeNull()
    expect(activeNavId(items, '/bundlesx')).toBeNull()
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
