import { describe, expect, it } from 'vitest'
import manifest from '../manifest'
import { appManifests, manifestForPath, settingsPartForPath } from '../../manifests'
import { canUse, featureForCapability, featureForPath, MODULE_FEATURES } from '../../registry'
import { bellKindFor } from '../../surfaces'
import { canReachPath } from '../../../utils/accessPolicy'
import { visibleShellModules } from '../../../composables/nav/shellModules'

const tenant = (capabilities: string[], features: { readable: string[]; writable: string[] } = { readable: ['sales.enabled'], writable: ['sales.enabled'] }) => ({
  role: 'user', capabilities, platform: { readable_features: features.readable, writable_features: features.writable },
})
const reachable = (path: string, capabilities: string[]) => canReachPath(tenant(capabilities), path)
const closed = { readable: ['hr.enabled'], writable: [] }

describe('sales manifest', () => {
  it('is discovered, owns /sales and the settings page, behind sales.enabled', () => {
    expect(appManifests.map(item => item.id)).toContain('sales')
    expect(manifestForPath('/sales/7/edit')?.id).toBe('sales')
    expect(manifest.feature).toBe('sales.enabled')
    expect(MODULE_FEATURES.sales).toBe('sales.enabled')
    expect(featureForPath('/sales')).toBe('sales.enabled')
    expect(featureForCapability('sales.orders.confirm')).toBe('sales.enabled')
    expect(settingsPartForPath('/settings/apps/sales')?.part.id).toBe('presets')
  })

  it('opens the list and a record to a reader, and the create and edit pages to a writer only', () => {
    expect(reachable('/sales', ['sales.read'])).toBe(true)
    expect(reachable('/sales/7', ['sales.read'])).toBe(true)
    expect(reachable('/sales/new', ['sales.read'])).toBe(false)
    expect(reachable('/sales/7/edit', ['sales.read', 'sales.orders.confirm'])).toBe(false)
    expect(reachable('/sales/new', ['sales.read', 'sales.quotations.manage'])).toBe(true)
    expect(reachable('/sales/7/edit', ['sales.read', 'sales.quotations.manage'])).toBe(true)
    expect(reachable('/sales', [])).toBe(false)
  })

  it('closes the rail entry and every route without the feature', () => {
    const writer = ['sales.read', 'sales.quotations.manage']
    expect(visibleShellModules(tenant(writer)).map(item => item.id)).toContain('sales')
    expect(visibleShellModules(tenant(writer, closed)).map(item => item.id)).not.toContain('sales')
    expect(canReachPath(tenant(writer, closed), '/sales')).toBe(false)
    expect(canReachPath(tenant(writer, closed), '/sales/new')).toBe(false)
    expect(canUse(tenant(writer, { readable: ['sales.enabled'], writable: [] }), 'sales.quotations.manage')).toBe(false)
  })

  it('opens the settings page to the settings right', () => {
    expect(reachable('/settings/apps/sales', ['sales.settings.manage'])).toBe(true)
    expect(reachable('/settings/apps/sales', ['sales.read'])).toBe(false)
  })

  it('words the customer\'s answer in the bell and opens the order', () => {
    const kind = bellKindFor('sales.answered')
    expect(manifest.bell?.capabilities).toEqual(['sales.read'])
    expect(kind?.href({ order_id: 7 })).toBe('/sales/7')
    expect(kind?.href({})).toBeNull()
    const words: Record<string, string> = { 'sales.bell.accepted': 'accepted', 'sales.bell.signed': 'signed', 'sales.bell.declined': 'declined' }
    for (const answer of ['accepted', 'signed', 'declined']) {
      expect(kind?.title?.({ answer, title: 'S00007' }, key => words[key] ?? key)).toBe(`${answer} S00007`)
    }
  })

  it('opens the report to a holder of the reports and read rights, and lists it for the reports right alone', () => {
    expect(reachable('/sales/reports', ['sales.read', 'sales.reports.read'])).toBe(true)
    expect(reachable('/sales/reports', ['sales.reports.read'])).toBe(false)
    expect(reachable('/sales/reports', ['sales.read'])).toBe(false)
    expect(manifest.nav.map(item => item.to)).toContain('/sales/reports')
    expect(manifest.contextLinks?.('/sales/reports').find(link => link.id === 'sales-reports')?.capability).toBe('sales.reports.read')
    expect(featureForCapability('sales.reports.read')).toBe('sales.enabled')
    expect(canReachPath(tenant(['sales.read', 'sales.reports.read'], closed), '/sales/reports')).toBe(false)
  })
})
