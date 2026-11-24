import { describe, expect, it, vi } from 'vitest'
import manifest from '../manifest'
import { meetingsSidebar } from '../sidebar'
import type { AppSearchApi, AppSidebarRoute } from '../../types'

const route = (path: string, query: Record<string, unknown> = {}): AppSidebarRoute => ({ path, query })
const activeRows = (current: AppSidebarRoute) => meetingsSidebar.rows.filter(item => item.active(current)).map(item => item.id)

describe('the meetings sidebar menu', () => {
  it('is the meetings manifest menu: a create link and five flat rows', () => {
    expect(manifest.sidebar).toBe(meetingsSidebar)
    expect(manifest.contextLinks?.('/meetings').find(link => link.id === meetingsSidebar.create)).toMatchObject({ pinned: true, capability: 'meetings.create' })
    expect(meetingsSidebar.rows.map(item => [item.id, item.capability])).toEqual([
      ['meetings', 'meetings.read'],
      ['my-meetings', 'meetings.read'],
      ['meeting-followup', 'meetings.read'],
      ['meeting-calendar', 'meetings.read'],
      ['meeting-series', 'meetings.read'],
    ])
  })

  it('lights one row per page', () => {
    expect(activeRows(route('/meetings'))).toEqual(['meetings'])
    expect(activeRows(route('/meetings/', { state: 'draft' }))).toEqual(['meetings'])
    expect(activeRows(route('/meetings/new'))).toEqual(['meetings'])
    expect(activeRows(route('/meetings', { mine: '1' }))).toEqual(['my-meetings'])
    expect(activeRows(route('/meetings', { mine: 'true' }))).toEqual(['my-meetings'])
    expect(activeRows(route('/meetings/follow-up'))).toEqual(['meeting-followup'])
    expect(activeRows(route('/meetings/calendar'))).toEqual(['meeting-calendar'])
    expect(activeRows(route('/meetings/series'))).toEqual(['meeting-series'])
    expect(activeRows(route('/meetings/series/14'))).toEqual(['meeting-series'])
    expect(activeRows(route('/meetings/7'))).toEqual([])
  })

  it('loads live counts for all meetings, my meetings, and active follow-up resolutions', async () => {
    const api = vi.fn()
      .mockResolvedValueOnce({ items: [], total: 14 })
      .mockResolvedValueOnce({ items: [], total: 5 })
      .mockResolvedValueOnce({ items: [], total: 3 })
    const loader = meetingsSidebar.counts![0]!
    expect(await loader.load(api as unknown as AppSearchApi)).toEqual({
      meetings: 14,
      'my-meetings': 5,
      'meeting-followup': 3,
    })
    expect(api).toHaveBeenNthCalledWith(1, '/api/v1/meetings', expect.objectContaining({ query: { limit: 1 } }))
    expect(api).toHaveBeenNthCalledWith(2, '/api/v1/meetings', expect.objectContaining({ query: { mine: 1, limit: 1 } }))
    expect(api).toHaveBeenNthCalledWith(3, '/api/v1/meetings/resolutions', expect.objectContaining({ query: { state: 'active', limit: 1 } }))
    expect(loader.queryKey[0]).toBe('meetings')
  })
})
