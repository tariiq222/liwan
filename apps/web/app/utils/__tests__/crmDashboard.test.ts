import { describe, expect, it } from 'vitest'
import type { CrmDashboard } from '@liwan/contracts'
import { agentKpiTiles, conversionPercent, managerKpiTiles } from '../crmDashboard'

const t = (key: string, named?: Record<string, unknown>) => (named ? `${key} ${JSON.stringify(named)}` : key)
const agent: CrmDashboard['agent'] = { due_now: 2, new_today: 3, won_this_month: { count: 4, value: 12500.5 } }
const manager = { unassigned: 0, needs_manager: 1, due_follow_ups: 5, won_this_month: { count: 6, value: 900 }, conversion_by_source: [], agents: [] }

describe('agentKpiTiles', () => {
  it('shows the four figures with the money formatted and the due tile linking to the due list', () => {
    const tiles = agentKpiTiles(agent, t)
    expect(tiles.map(tile => tile.value)).toEqual([2, 3, 4, '12,500.5'])
    expect(tiles[0]).toMatchObject({ tone: 'warning', to: '/crm/opportunities?due=1' })
  })
  it('keeps the due tile neutral when nothing is due', () => {
    expect(agentKpiTiles({ ...agent, due_now: 0 }, t)[0]!.tone).toBe('neutral')
  })
})

describe('managerKpiTiles', () => {
  it('links each count to the list it counts and tones only the non-zero ones', () => {
    const tiles = managerKpiTiles(manager, t)
    expect(tiles.map(tile => tile.to)).toEqual(['/crm/opportunities?unassigned=1', '/crm/opportunities?needs_manager=1', '/crm/opportunities?due=1', undefined])
    expect(tiles.slice(0, 3).map(tile => tile.tone)).toEqual(['neutral', 'danger', 'warning'])
  })
  it('shows the won count with its value as the caption', () => {
    const won = managerKpiTiles(manager, t)[3]!
    expect(won.value).toBe(6)
    expect(won.hint).toContain('"value":"900"')
  })
})

describe('conversionPercent', () => {
  it('rounds to a whole percent and survives an empty source', () => {
    expect(conversionPercent(1, 3)).toBe(33)
    expect(conversionPercent(0, 0)).toBe(0)
  })
})
