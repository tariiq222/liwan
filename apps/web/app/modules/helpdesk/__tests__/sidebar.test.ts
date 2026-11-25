import { describe, expect, it, vi } from 'vitest'
import manifest from '../manifest'
import { helpdeskSidebar } from '../sidebar'
import { flatSidebar } from '../../../composables/nav/flatSidebar'
import type { AppSearchApi, AppSidebarRoute } from '../../types'

const route = (path: string, query: Record<string, unknown> = {}): AppSidebarRoute => ({ path, query })
const activeRows = (current: AppSidebarRoute) => helpdeskSidebar.rows.filter(item => item.active(current)).map(item => item.id)

describe('the helpdesk sidebar menu', () => {
  it('is wired into the manifest with a pinned create link, queue rows, and reports', () => {
    expect(manifest.sidebar).toBe(helpdeskSidebar)
    expect(manifest.contextLinks?.('/helpdesk').find(link => link.id === helpdeskSidebar.create)).toMatchObject({
      pinned: true,
      to: '/helpdesk/new',
      capability: 'helpdesk.requests.create',
    })
    expect(helpdeskSidebar.rows.map(item => [item.id, item.capability, item.to])).toEqual([
      ['helpdesk-tickets', 'helpdesk.requests.read', { path: '/helpdesk' }],
      ['helpdesk-unassigned', 'helpdesk.tickets.read', { path: '/helpdesk', query: { assignee: 'none' } }],
      ['helpdesk-mine', 'helpdesk.tickets.read', { path: '/helpdesk', query: { assignee: 'me' } }],
      ['helpdesk-reports', 'helpdesk.reports.read', { path: '/helpdesk/reports' }],
    ])
  })

  it('shows the tickets row to an agent holding only helpdesk.tickets.read', () => {
    const canOpen = vi.fn((capability: string) => capability === 'helpdesk.tickets.read')
    const menu = flatSidebar({
      menu: helpdeskSidebar,
      route: route('/helpdesk'),
      canOpen,
      create: null,
      counts: {},
      recents: [],
      translate: key => key,
    })
    const ids = menu.sections.flatMap(section => section.items.map(item => item.id))

    expect(ids).toContain('helpdesk-tickets')
    expect(canOpen).toHaveBeenCalledWith('helpdesk.requests.read', '/helpdesk')
    expect(canOpen).toHaveBeenCalledWith('helpdesk.tickets.read', '/helpdesk')
  })

  it('lights one row per helpdesk destination', () => {
    expect(activeRows(route('/helpdesk'))).toEqual(['helpdesk-tickets'])
    expect(activeRows(route('/helpdesk/', { priority: 'urgent' }))).toEqual(['helpdesk-tickets'])
    expect(activeRows(route('/helpdesk/new'))).toEqual(['helpdesk-tickets'])
    expect(activeRows(route('/helpdesk', { assignee: 'none' }))).toEqual(['helpdesk-unassigned'])
    expect(activeRows(route('/helpdesk', { assignee: 'me' }))).toEqual(['helpdesk-mine'])
    expect(activeRows(route('/helpdesk/reports'))).toEqual(['helpdesk-reports'])
    expect(activeRows(route('/helpdesk/42'))).toEqual([])
  })

  it('loads open, unassigned, and mine counts from /api/v1/helpdesk/summary under helpdesk.tickets.read', async () => {
    const api = vi.fn().mockResolvedValueOnce({ open: 19, unassigned: 4, mine: 6, overdue: 2 })
    const loader = helpdeskSidebar.counts![0]!

    expect(loader.capability).toBe('helpdesk.tickets.read')
    expect(loader.queryKey.slice(0, 2)).toEqual(['helpdesk', 'summary'])
    expect(await loader.load(api as unknown as AppSearchApi)).toEqual({
      'helpdesk-tickets': 19,
      'helpdesk-unassigned': 4,
      'helpdesk-mine': 6,
    })
    expect(api).toHaveBeenCalledWith('/api/v1/helpdesk/summary', expect.anything())
  })
})
