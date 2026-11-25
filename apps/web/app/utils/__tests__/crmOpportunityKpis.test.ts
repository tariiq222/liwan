import { describe, expect, it } from 'vitest'
import {
  crmOpportunityKpiFilters,
  crmOpportunityKpiScope,
  crmOpportunityKpiTiles,
  crmOpportunityMatchingTile,
} from '../crmOpportunityKpis'

const t = (key: string) => key

describe('CRM opportunity KPI helpers', () => {
  it('strips status and due from the scope filters while keeping all other filters', () => {
    expect(crmOpportunityKpiScope({
      q: 'acme',
      stage_id: 2,
      user_id: 5,
      source_id: 9,
      unassigned: true,
      needs_manager: true,
      status: 'won',
      due: true,
    })).toEqual({
      q: 'acme',
      stage_id: 2,
      user_id: 5,
      source_id: 9,
      unassigned: true,
      needs_manager: true,
    })
  })

  it('identifies which tile matches the active list query so list total can be reused', () => {
    expect(crmOpportunityMatchingTile({})).toBe('open')
    expect(crmOpportunityMatchingTile({ status: 'open', stage_id: 3 })).toBe('open')
    expect(crmOpportunityMatchingTile({ status: 'won' })).toBe('won')
    expect(crmOpportunityMatchingTile({ status: 'lost' })).toBe('lost')
    expect(crmOpportunityMatchingTile({ due: true })).toBe('due')
    expect(crmOpportunityMatchingTile({ status: 'open', due: true })).toBe('due')
    expect(crmOpportunityMatchingTile({ status: 'all' })).toBeNull()
    expect(crmOpportunityMatchingTile({ status: 'won', due: true })).toBeNull()
  })

  it('builds per-tile API filters on top of scope', () => {
    expect(crmOpportunityKpiFilters({ stage_id: 4, q: 'test' })).toEqual({
      open: { stage_id: 4, q: 'test' },
      won: { stage_id: 4, q: 'test', status: 'won' },
      lost: { stage_id: 4, q: 'test', status: 'lost' },
      due: { stage_id: 4, q: 'test', due: true },
    })
  })

  it('builds the four tiles with matching filter links, clearTo preserving scope and view, and tones', () => {
    const tiles = crmOpportunityKpiTiles(
      { open: 12, won: 5, lost: 2, due: 3 },
      { q: 'sara', stage_id: 7, user_id: 4 },
      t,
      'board',
    )
    const base = '/crm/opportunities?q=sara&stage_id=7&user_id=4&view=board'
    expect(tiles).toEqual([
      { id: 'open', label: 'crm.opportunities.kpi.open', icon: 'i-lucide-handshake', tone: 'neutral', value: 12, to: base, clearTo: base },
      { id: 'won', label: 'crm.opportunities.kpi.won', icon: 'i-lucide-circle-check', tone: 'success', value: 5, to: `${base}&status=won`, clearTo: base },
      { id: 'lost', label: 'crm.opportunities.kpi.lost', icon: 'i-lucide-circle-x', tone: 'danger', value: 2, to: `${base}&status=lost`, clearTo: base },
      { id: 'due', label: 'crm.opportunities.kpi.due', icon: 'i-lucide-phone-forwarded', tone: 'warning', value: 3, to: `${base}&due=1`, clearTo: base },
    ])
  })

  it('uses neutral tones when lost/due are zero and null values while counts are pending', () => {
    const tiles = crmOpportunityKpiTiles({ open: 0, won: 0, lost: 0, due: 0 }, {}, t)
    expect(tiles.find(tile => tile.id === 'lost')?.tone).toBe('neutral')
    expect(tiles.find(tile => tile.id === 'due')?.tone).toBe('neutral')
    expect(tiles.map(tile => tile.clearTo)).toEqual([
      '/crm/opportunities',
      '/crm/opportunities',
      '/crm/opportunities',
      '/crm/opportunities',
    ])

    const pending = crmOpportunityKpiTiles({}, {}, t)
    expect(pending.map(tile => tile.value)).toEqual([null, null, null, null])
  })

  it('leaves the tile reusing the list total null while that total is a placeholder', () => {
    const tiles = crmOpportunityKpiTiles({ open: undefined, won: 5, lost: 2, due: 3 }, {}, t)
    expect(tiles.map(tile => tile.value)).toEqual([null, 5, 2, 3])
  })
})
