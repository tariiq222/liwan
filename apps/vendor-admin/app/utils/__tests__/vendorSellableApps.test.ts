import { describe, expect, it } from 'vitest'
import { sellableApps } from '../vendorEntitlement'

/** A release tier as the catalog lists it for sale. `sellable` is absent in a catalog published before the flag. */
type App = { id: string; selectable: boolean; sellable?: boolean; features: Array<{ key: string; kind: string }> }
const release = (applications: App[]) => ({ applications })

describe('sellable applications of a release', () => {
  it('lists only the tiers the catalog sells', () => {
    const apps = sellableApps(release([
      { id: 'core', selectable: false, sellable: false, features: [] },
      { id: 'crm', selectable: true, sellable: true, features: [] },
      { id: 'inbox', selectable: true, sellable: true, features: [] },
      { id: 'people', selectable: true, sellable: false, features: [] },
      { id: 'finance', selectable: true, sellable: false, features: [] },
    ]))
    expect(apps.map(app => app.id)).toEqual(['crm', 'inbox'])
  })

  it('treats a catalog published before the flag as selling every selectable tier', () => {
    const apps = sellableApps(release([
      { id: 'core', selectable: false, features: [] },
      { id: 'projects', selectable: true, features: [] },
      { id: 'people', selectable: true, features: [] },
    ]))
    expect(apps.map(app => app.id)).toEqual(['projects', 'people'])
  })

  it('never lists the core tier, even if a catalog were to flag it', () => {
    expect(sellableApps(release([{ id: 'core', selectable: true, sellable: true, features: [] }]))).toEqual([])
  })

  it('answers an empty list for an absent release', () => {
    expect(sellableApps(null)).toEqual([])
    expect(sellableApps(undefined)).toEqual([])
  })
})
