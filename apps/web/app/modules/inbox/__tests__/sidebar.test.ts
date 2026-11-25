import { describe, expect, it, vi } from 'vitest'
import manifest from '../manifest'
import { inboxSidebar } from '../sidebar'
import { flatSidebar } from '../../../composables/nav/flatSidebar'
import { inboxConversationKpiFilters } from '../../../utils/inboxKpis'
import type { AppSearchApi, AppSidebarRoute } from '../../types'

const route = (path: string, query: Record<string, unknown> = {}): AppSidebarRoute => ({ path, query })
const activeRows = (current: AppSidebarRoute) => inboxSidebar.rows.filter(item => item.active(current)).map(item => item.id)

describe('the inbox sidebar menu', () => {
  it('is wired into the manifest with the pinned new-campaign link and one row per destination', () => {
    expect(manifest.sidebar).toBe(inboxSidebar)
    expect(manifest.contextLinks?.('/inbox').find(link => link.id === inboxSidebar.create)).toMatchObject({
      pinned: true,
      to: '/inbox/campaigns/new',
      capability: 'inbox.campaigns.manage',
      feature: 'inbox.campaigns',
    })
    expect(inboxSidebar.rows.map(item => [item.id, item.capability, item.to, item.section?.id])).toEqual([
      ['inbox-conversations', 'inbox.conversations.read', { path: '/inbox' }, 'inbox-work'],
      ['inbox-unassigned', 'inbox.conversations.read', { path: '/inbox', query: { state: 'open', assignee: 'unassigned' } }, 'inbox-work'],
      ['inbox-mine', 'inbox.conversations.read', { path: '/inbox', query: { state: 'open', assignee: 'me' } }, 'inbox-work'],
      ['inbox-orders', 'inbox.conversations.read', { path: '/inbox/orders' }, 'inbox-work'],
      ['inbox-campaigns', 'inbox.campaigns.manage', { path: '/inbox/campaigns' }, 'inbox-outreach'],
      ['inbox-audiences', 'inbox.campaigns.manage', { path: '/inbox/campaigns/audiences' }, 'inbox-outreach'],
      ['inbox-reports', 'inbox.reports.read', { path: '/inbox/reports' }, 'inbox-insight'],
    ])
  })

  it('shows an agent only the rows their capabilities and the route rules open', () => {
    const canOpen = (capability: string) => capability === 'inbox.conversations.read'
    const menu = flatSidebar({ menu: inboxSidebar, route: route('/inbox'), canOpen, create: null, counts: {}, recents: [], translate: key => key })
    expect(menu.actions).toEqual([])
    expect(menu.sections.flatMap(section => section.items.map(item => item.id))).toEqual(['inbox-conversations', 'inbox-unassigned', 'inbox-mine', 'inbox-orders'])
  })

  it('lights one row per inbox destination, an open conversation keeping its queue', () => {
    expect(activeRows(route('/inbox'))).toEqual(['inbox-conversations'])
    expect(activeRows(route('/inbox/', { state: 'pending' }))).toEqual(['inbox-conversations'])
    expect(activeRows(route('/inbox/12/contact'))).toEqual(['inbox-conversations'])
    expect(activeRows(route('/inbox', { assignee: 'unassigned' }))).toEqual(['inbox-unassigned'])
    expect(activeRows(route('/inbox/12', { assignee: 'me' }))).toEqual(['inbox-mine'])
    expect(activeRows(route('/inbox/orders'))).toEqual(['inbox-orders'])
    expect(activeRows(route('/inbox/campaigns/new'))).toEqual(['inbox-campaigns'])
    expect(activeRows(route('/inbox/campaigns/7'))).toEqual(['inbox-campaigns'])
    expect(activeRows(route('/inbox/campaigns/audiences/3'))).toEqual(['inbox-audiences'])
    expect(activeRows(route('/inbox/reports/templates'))).toEqual(['inbox-reports'])
    expect(activeRows(route('/inbox/flows/5'))).toEqual([])
  })

  it('counts the open queues with limit=1 totals of the same queries the rows open', async () => {
    const api = vi.fn()
      .mockResolvedValueOnce({ items: [], total: 4 })
      .mockResolvedValueOnce({ items: [], total: 9 })
    const loader = inboxSidebar.counts![0]!
    expect(loader.capability).toBe('inbox.conversations.read')
    expect(loader.queryKey[0]).toBe('inbox')
    expect(await loader.load(api as unknown as AppSearchApi)).toEqual({ 'inbox-unassigned': 4, 'inbox-mine': 9 })
    expect(api).toHaveBeenCalledWith('/api/v1/inbox/conversations', expect.objectContaining({ query: { state: 'open', assignee: 'unassigned', limit: 1 } }))
    expect(api).toHaveBeenCalledWith('/api/v1/inbox/conversations', expect.objectContaining({ query: { state: 'open', assignee: 'me', limit: 1 } }))
  })

  it('asks for the two open queues under the key the conversation KPI tiles read', () => {
    // A conversations page with no scope filter builds these exact filters; the caller appends its owner to both keys,
    // so the page and the menu share one request pair instead of asking twice.
    const filters = inboxConversationKpiFilters({})
    expect(inboxSidebar.counts![0]!.queryKey).toEqual(['inbox', 'conversations', 'queues', filters.unassigned, filters.mine])
  })

  it('counts campaigns and audiences only behind the campaigns capability and sub-feature', async () => {
    const api = vi.fn()
      .mockResolvedValueOnce({ items: [], total: 6 })
      .mockResolvedValueOnce({ items: [], total: 2 })
    const loader = inboxSidebar.counts![1]!
    expect([loader.capability, loader.feature]).toEqual(['inbox.campaigns.manage', 'inbox.campaigns'])
    expect(await loader.load(api as unknown as AppSearchApi)).toEqual({ 'inbox-campaigns': 6, 'inbox-audiences': 2 })
    expect(api).toHaveBeenCalledWith('/api/v1/inbox/audiences', expect.objectContaining({ query: { limit: 1 } }))
  })
})
