import { describe, expect, it } from 'vitest'
import { lockedApplicationView } from '../lockedApplication'

const platform = (state: string, readable: string[]) => ({ state, read_only: state !== 'active', readable_features: readable, writable_features: [] })
const crm = (extra: Record<string, unknown> = {}) => ({ capabilities: ['crm.leads.read'], platform: platform('active', []), ...extra })

describe('lockedApplicationView', () => {
  it('names the application from its manifest and calls an unreadable closed application not in the plan', () => {
    const view = lockedApplicationView(crm() as never, '/crm/opportunities', 'feature_not_included', true)
    expect(view).toEqual({ cause: 'not_in_plan', audience: 'manager', labelKey: 'nav.crm', dataPath: null })
  })

  it('separates the unpaid-invoice lock from another read-only tenant', () => {
    expect(lockedApplicationView(crm({ platform: platform('payment_suspended', ['crm.enabled']) }) as never, '/crm', 'tenant_read_only', false).cause).toBe('payment_suspended')
    expect(lockedApplicationView(crm({ platform: platform('expired', ['crm.enabled']) }) as never, '/crm', 'tenant_read_only', false).cause).toBe('read_only')
  })

  it('offers existing data only when the application is readable and its page opens', () => {
    const readable = lockedApplicationView(crm({ platform: platform('payment_suspended', ['crm.enabled']) }) as never, '/crm/imports', 'tenant_read_only', true)
    expect(readable.dataPath).toMatch(/^\/crm/)
    const closed = lockedApplicationView(crm({ platform: platform('payment_suspended', []) }) as never, '/crm/imports', 'feature_not_included', true)
    expect(closed.dataPath).toBeNull()
  })

  it('treats non_saas as not enabled for everyone', () => {
    const view = lockedApplicationView(crm({ commercial: { mode: 'non_saas' } }) as never, '/crm', 'feature_not_included', true)
    expect(view).toMatchObject({ cause: 'not_enabled', audience: 'non_saas' })
  })

  it('gives a foundation path no application name', () => {
    expect(lockedApplicationView(crm() as never, '/account', 'feature_not_included', false).labelKey).toBeNull()
  })
})
