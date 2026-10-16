import { describe, expect, it } from 'vitest'
import { allPages, CATALOG_TABS, catalogReturn, catalogTabOf, plansUsingBundle, priceFact } from '../vendorCatalog'
import type { PlanView } from '../vendorCommercial'

describe('catalogTabOf', () => {
  it('names the tab of every catalog path, lists, records and forms alike', () => {
    expect(catalogTabOf('/plans')?.key).toBe('plans')
    expect(catalogTabOf('/plans/new')?.key).toBe('plans')
    expect(catalogTabOf('/plans/p-1/edit/')?.key).toBe('plans')
    expect(catalogTabOf('/bundles/b-1')?.key).toBe('bundles')
    expect(catalogTabOf('/catalog/pkg-1')?.key).toBe('packages')
    expect(catalogTabOf('/catalog?status=draft')?.key).toBe('packages')
  })

  it('ignores paths outside the catalog and mere prefixes', () => {
    expect(catalogTabOf('/customers')).toBeNull()
    expect(catalogTabOf('/plansx')).toBeNull()
    expect(catalogTabOf('/')).toBeNull()
  })

  it('offers the three tabs in the fixed order', () => {
    expect(CATALOG_TABS.map(tab => tab.key)).toEqual(['plans', 'bundles', 'packages'])
  })
})

describe('catalogReturn', () => {
  it('keeps a return to any catalog tab and names that tab', () => {
    expect(catalogReturn('/bundles/b-1?x=1', 'plans')).toEqual({ to: '/bundles/b-1?x=1', labelKey: 'vendor.bundles.title' })
    expect(catalogReturn('/plans?status=draft', 'bundles')).toEqual({ to: '/plans?status=draft', labelKey: 'vendor.plans.title' })
    expect(catalogReturn('/catalog/pkg-1', 'plans')).toEqual({ to: '/catalog/pkg-1', labelKey: 'vendor.packages.title' })
  })

  it('falls back to the own list for anything else', () => {
    for (const value of [undefined, '', '//evil.com', 'https://evil.com/plans', '/customers', '/plansx', '/plans\\evil']) {
      expect(catalogReturn(value, 'bundles')).toEqual({ to: '/bundles', labelKey: 'vendor.bundles.title' })
    }
  })
})

describe('priceFact', () => {
  const labels = { none: 'none', more: (count: number) => `+${count}` }
  const price = (unit: string) => ({ cadence: { unit, count: 1 } }) as PlanView['prices'][number]
  const describe = (p: PlanView['prices'][number]) => p.cadence.unit

  it('shows the first cadence and how many others exist', () => {
    expect(priceFact([], describe, labels)).toBe('none')
    expect(priceFact([price('month')], describe, labels)).toBe('month')
    expect(priceFact([price('month'), price('year'), price('week')], describe, labels)).toBe('month · +2')
  })
})

describe('allPages and plansUsingBundle', () => {
  const plan = (id: string, version: number, included: string[], optional: string[] = []) => ({ id, version, included_bundle_revision_ids: included, optional_bundle_revision_ids: optional }) as PlanView
  const pager = (all: PlanView[], size: number) => async ({ limit, offset }: { limit: number, offset: number }) => {
    expect(limit).toBe(200)
    return { items: all.slice(offset, offset + size), total: all.length }
  }

  it('follows the total across pages', async () => {
    const all = Array.from({ length: 450 }, (_, i) => plan(`p${i}`, 1, []))
    expect((await allPages(pager(all, 200))).length).toBe(450)
  })

  it('stops on an empty page even when the total promises more', async () => {
    const fetchPage = async ({ offset }: { limit: number, offset: number }) => ({ items: offset ? [] : [plan('p', 1, [])], total: 99 })
    expect(await allPages(fetchPage)).toHaveLength(1)
  })

  it('keeps every plan version that includes or offers the bundle version, found beyond the first page', async () => {
    const all = [...Array.from({ length: 200 }, (_, i) => plan(`x${i}`, 1, ['other'])), plan('p2', 2, ['b1']), plan('p1', 1, [], ['b1'])]
    const used = await plansUsingBundle(pager(all, 200), 'b1')
    expect(used?.map(p => [p.id, p.version])).toEqual([['p2', 2], ['p1', 1]])
  })

  it('reports null, not an empty list, when the plans cannot be loaded', async () => {
    expect(await plansUsingBundle(async () => { throw new Error('down') }, 'b1')).toBeNull()
  })
})
