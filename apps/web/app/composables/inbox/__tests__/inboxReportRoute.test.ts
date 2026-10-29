import { describe, expect, it } from 'vitest'
import {
  breakdownQuery, costQuery, lastDaysRange, overviewQuery, parseInboxReportRoute, reportRange, serializeInboxReportRoute, shiftIsoDay,
} from '../inboxReportRoute'

const TODAY = new Date(2026, 9, 29, 12)

describe('inbox report route', () => {
  it('defaults to the last 30 days with no filters', () => {
    const route = parseInboxReportRoute({})
    expect(route).toEqual({ period: '30', from: '', to: '', channelId: null, departmentId: null, agentId: null })
    expect(reportRange(route, TODAY)).toEqual({ from: '2026-09-30', to: '2026-10-29' })
    expect(serializeInboxReportRoute(route)).toEqual({})
  })

  it('reads a quick period, the filters and ignores nonsense', () => {
    expect(parseInboxReportRoute({ period: '7', channel_id: '4', department_id: '2', agent_id: '9' })).toMatchObject({ period: '7', channelId: 4, departmentId: 2, agentId: 9 })
    expect(parseInboxReportRoute({ period: '45', channel_id: 'x', agent_id: '-3' })).toMatchObject({ period: '30', channelId: null, agentId: null })
  })

  it('keeps a custom range only when it runs forward and fits the limit (1, 366 ok; reversed and 367 fall back)', () => {
    expect(parseInboxReportRoute({ from: '2026-10-29', to: '2026-10-29' }).period).toBe('custom')
    expect(parseInboxReportRoute({ from: '2025-10-29', to: '2026-10-29' }).period).toBe('custom')
    expect(parseInboxReportRoute({ from: '2025-10-28', to: '2026-10-29' }).period).toBe('30')
    expect(parseInboxReportRoute({ from: '2026-10-29', to: '2026-10-28' }).period).toBe('30')
    expect(parseInboxReportRoute({ from: '2026-10-1', to: '2026-10-28' }).period).toBe('30')
  })

  it('applies the template-analytics limit of 90 days to both the range and the quick periods', () => {
    expect(parseInboxReportRoute({ from: '2026-08-01', to: '2026-10-29' }, 90).period).toBe('custom')
    expect(parseInboxReportRoute({ from: '2026-07-01', to: '2026-10-29' }, 90).period).toBe('30')
    expect(parseInboxReportRoute({ period: '90' }, 90).period).toBe('90')
  })

  it('writes only what differs from the defaults and round-trips', () => {
    const route = { period: 'custom' as const, from: '2026-10-01', to: '2026-10-15', channelId: 1, departmentId: null, agentId: 6 }
    const query = serializeInboxReportRoute(route)
    expect(query).toEqual({ from: '2026-10-01', to: '2026-10-15', channel_id: '1', agent_id: '6' })
    expect(parseInboxReportRoute(query)).toEqual(route)
    expect(serializeInboxReportRoute({ ...route, period: '90', from: '', to: '' })).toEqual({ period: '90', channel_id: '1', agent_id: '6' })
  })

  it('builds contract-valid queries; the breakdown never carries an agent filter', () => {
    const route = parseInboxReportRoute({ period: '7', channel_id: '1', agent_id: '6' })
    expect(overviewQuery(route, TODAY)).toEqual({ from: '2026-10-23', to: '2026-10-29', channel_id: 1, agent_id: 6 })
    expect(breakdownQuery(route, TODAY)).toEqual({ from: '2026-10-23', to: '2026-10-29', channel_id: 1 })
    expect(costQuery(route, TODAY)).toEqual({ from: '2026-10-23', to: '2026-10-29', channel_id: 1 })
  })

  it('does day arithmetic on bare dates across a month end', () => {
    expect(shiftIsoDay('2026-03-01', -1)).toBe('2026-02-28')
    expect(lastDaysRange(1, TODAY)).toEqual({ from: '2026-10-29', to: '2026-10-29' })
  })
})
