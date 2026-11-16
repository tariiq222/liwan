import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'

// The quotations of an opportunity are read with both applications' read rights and written with the opportunity read and
// the right to write quotations; the server checks the same pairs.
let held = new Set<string>()
vi.mock('@tanstack/vue-query', () => ({ useQuery: () => ({}), useMutation: () => ({}), useQueryClient: () => ({}) }))
vi.stubGlobal('useApi', () => ({ $api: vi.fn() }))
vi.stubGlobal('useAccess', () => ({ can: (key: string) => held.has(key) }))
vi.stubGlobal('computed', Vue.computed)
vi.stubGlobal('toValue', Vue.toValue)

const { useOpportunityOrderAccess } = await import('../useOpportunityBridges')
const access = (...keys: string[]) => {
  held = new Set(keys)
  const result = useOpportunityOrderAccess()
  return { read: result.read.value, write: result.write.value }
}

describe('useOpportunityOrderAccess', () => {
  it('reads with CRM and Sales reads, and writes with the CRM read and the right to write quotations', () => {
    expect(access('crm.leads.read', 'sales.read', 'sales.quotations.manage')).toEqual({ read: true, write: true })
  })

  it('is closed without either application', () => {
    expect(access('sales.read', 'sales.quotations.manage')).toEqual({ read: false, write: false })
    expect(access('crm.leads.read')).toEqual({ read: false, write: false })
  })

  it('lets a Sales reader list but not write, and a manager of quotations without the Sales read still write', () => {
    expect(access('crm.leads.read', 'sales.read')).toEqual({ read: true, write: false })
    expect(access('crm.leads.read', 'sales.quotations.manage')).toEqual({ read: false, write: true })
  })
})
