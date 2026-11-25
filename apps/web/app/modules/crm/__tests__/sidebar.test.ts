import { describe, expect, it, vi } from 'vitest'
import manifest from '../manifest'
import { crmSidebar } from '../sidebar'
import type { AppSearchApi, AppSidebarRoute } from '../../types'

const route = (path: string, query: Record<string, unknown> = {}): AppSidebarRoute => ({ path, query })
const activeRows = (current: AppSidebarRoute) => crmSidebar.rows.filter(item => item.active(current)).map(item => item.id)

describe('the CRM sidebar menu', () => {
  it('is the CRM manifest menu: a create link, three flat rows and no recent records', () => {
    expect(manifest.sidebar).toBe(crmSidebar)
    expect(manifest.contextLinks?.('/crm').find(link => link.id === crmSidebar.create)).toMatchObject({ pinned: true, capability: 'crm.leads.read' })
    expect(crmSidebar.rows.map(item => [item.id, item.capability])).toEqual([
      ['crm-dashboard', 'crm.leads.read'],
      ['crm-opportunities', 'crm.leads.read'],
      ['crm-imports', 'crm.leads.import'],
    ])
    expect(crmSidebar.recent).toBeUndefined()
  })

  it('lights one row per page', () => {
    expect(activeRows(route('/crm'))).toEqual(['crm-dashboard'])
    expect(activeRows(route('/crm/'))).toEqual(['crm-dashboard'])
    expect(activeRows(route('/crm/opportunities', { view: 'board' }))).toEqual(['crm-opportunities'])
    expect(activeRows(route('/crm/opportunities/12'))).toEqual(['crm-opportunities'])
    expect(activeRows(route('/crm/imports'))).toEqual(['crm-imports'])
    expect(activeRows(route('/crm/imports/new'))).toEqual(['crm-imports'])
    expect(activeRows(route('/crm/audit'))).toEqual([])
  })

  it('loads both counts as list totals asked for one row', async () => {
    const api = vi.fn()
      .mockResolvedValueOnce({ items: [], total: 18 })
      .mockResolvedValueOnce({ items: [], total: 2 })
    const [opportunities, imports] = crmSidebar.counts!
    expect(await opportunities!.load(api as unknown as AppSearchApi)).toEqual({ 'crm-opportunities': 18 })
    expect(await imports!.load(api as unknown as AppSearchApi)).toEqual({ 'crm-imports': 2 })
    expect(api).toHaveBeenNthCalledWith(1, '/api/v1/crm/opportunities', expect.objectContaining({ query: { limit: 1 } }))
    expect(api).toHaveBeenNthCalledWith(2, '/api/v1/crm/imports', expect.objectContaining({ query: { limit: 1 } }))
    expect(opportunities!.queryKey.slice(0, 1)).toEqual(['crm'])
    expect(imports!.queryKey.slice(0, 1)).toEqual(['crm'])
  })
})
