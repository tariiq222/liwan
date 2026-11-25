import { describe, expect, it } from 'vitest'
import {
  INBOX_CAMPAIGN_KPI_KEYS,
  INBOX_CONVERSATION_KPI_KEYS,
  INBOX_ORDER_KPI_KEYS,
  inboxCampaignKpiFilters,
  inboxCampaignKpiLinks,
  inboxCampaignTiles,
  inboxConversationKpiFilters,
  inboxConversationKpiLinks,
  inboxConversationTiles,
  inboxOrderKpiFilters,
  inboxOrderKpiLinks,
  inboxOrderTiles,
} from '../inboxKpis'

const t = (key: string) => `t:${key}`

describe('conversation KPI filters and links', () => {
  it('asks one row per tile under the scope, each tile adding its own owner or state', () => {
    const filters = inboxConversationKpiFilters({ q: 'سعر', priority: 'high', channel: 'whatsapp', channelId: 4, departmentId: 2, csat: 'bad', unreadOnly: true })
    expect(filters.open).toEqual({ q: 'سعر', priority: 'high', channel_kind: 'whatsapp', channel_id: 4, department_id: 2, csat: 'bad', unread: 'true', state: 'open', limit: 1 })
    expect(filters.pending).toMatchObject({ state: 'pending', limit: 1 })
    expect(filters.unassigned).toMatchObject({ state: 'open', assignee: 'unassigned', limit: 1 })
    expect(filters.mine).toMatchObject({ state: 'open', assignee: 'me', limit: 1 })
    expect(Object.keys(filters)).toEqual([...INBOX_CONVERSATION_KPI_KEYS])
  })

  it('leaves the page owner and state out of the shared scope, and names the kind `channel` in links', () => {
    const filters = inboxConversationKpiFilters({ channel: 'whatsapp' })
    expect(filters.open.assignee).toBeUndefined()
    const links = inboxConversationKpiLinks({ channel: 'whatsapp', departmentId: 3 })
    expect(links.base).toBe('/inbox?channel=whatsapp&department_id=3')
    expect(links.open).toBe('/inbox?channel=whatsapp&department_id=3&state=open')
    expect(links.unassigned).toBe('/inbox?channel=whatsapp&department_id=3&state=open&assignee=unassigned')
    expect(links.mine).toBe('/inbox?channel=whatsapp&department_id=3&state=open&assignee=me')
    expect(links).not.toHaveProperty('channel_kind')
  })
})

describe('conversation KPI tiles', () => {
  it('renders the counts, or "—" while one has not arrived, and clears back to the scope', () => {
    const links = inboxConversationKpiLinks({ q: 'x' })
    const tiles = inboxConversationTiles({ open: 12, pending: 0, unassigned: 3 }, links, t)
    expect(tiles.map(tile => tile.id)).toEqual([...INBOX_CONVERSATION_KPI_KEYS])
    expect(tiles.map(tile => [tile.value, tile.tone, tile.to, tile.clearTo])).toEqual([
      [12, 'neutral', '/inbox?q=x&state=open', '/inbox?q=x'],
      [0, 'neutral', '/inbox?q=x&state=pending', '/inbox?q=x'],
      [3, 'warning', '/inbox?q=x&state=open&assignee=unassigned', '/inbox?q=x'],
      [null, 'neutral', '/inbox?q=x&state=open&assignee=me', '/inbox?q=x'],
    ])
    expect(tiles[3]?.label).toBe('t:inbox.kpi.mine')
  })
})

describe('order KPI filters and tiles', () => {
  it('counts every order, the carts, the placed orders and the paid ones', () => {
    const filters = inboxOrderKpiFilters({ q: 'book', channelId: 9 })
    expect(filters.total).toEqual({ q: 'book', channel_id: 9, limit: 1 })
    expect(filters.cart).toEqual({ q: 'book', channel_id: 9, state: 'cart', limit: 1 })
    expect(filters.ordered).toEqual({ q: 'book', channel_id: 9, state: 'ordered', limit: 1 })
    expect(filters.paid).toEqual({ q: 'book', channel_id: 9, payment_status: 'paid', limit: 1 })
    expect(Object.keys(filters)).toEqual([...INBOX_ORDER_KPI_KEYS])
  })

  it('links each tile to its own filter and keeps the total unfiltered', () => {
    const links = inboxOrderKpiLinks({ channelId: 9 })
    expect(links.total).toBe('/inbox/orders?channel_id=9')
    expect(links.cart).toBe('/inbox/orders?channel_id=9&state=cart')
    expect(links.paid).toBe('/inbox/orders?channel_id=9&payment_status=paid')
    const tiles = inboxOrderTiles({ total: 20, cart: 2, ordered: 8, paid: 5 }, links, t)
    expect(tiles.map(tile => [tile.id, tile.value, tile.tone, tile.clearTo])).toEqual([
      ['total', 20, 'neutral', undefined],
      ['cart', 2, 'warning', '/inbox/orders?channel_id=9'],
      ['ordered', 8, 'neutral', '/inbox/orders?channel_id=9'],
      ['paid', 5, 'success', '/inbox/orders?channel_id=9'],
    ])
  })
})

describe('campaign KPI filters and tiles', () => {
  it('counts every campaign and each live state', () => {
    const filters = inboxCampaignKpiFilters({ q: 'eid' })
    expect(filters.total).toEqual({ q: 'eid', limit: 1 })
    expect(filters.draft).toEqual({ q: 'eid', state: 'draft', limit: 1 })
    expect(filters.paused).toEqual({ q: 'eid', state: 'paused', limit: 1 })
    expect(Object.keys(filters)).toEqual([...INBOX_CAMPAIGN_KPI_KEYS])
  })

  it('colours only the paused figure, and only when it is not zero', () => {
    const links = inboxCampaignKpiLinks({})
    const tiles = inboxCampaignTiles({ total: 9, draft: 2, scheduled: 1, running: 3, paused: 0 }, links, t)
    expect(tiles.map(tile => [tile.id, tile.tone, tile.to])).toEqual([
      ['total', 'neutral', '/inbox/campaigns'],
      ['draft', 'neutral', '/inbox/campaigns?state=draft'],
      ['scheduled', 'neutral', '/inbox/campaigns?state=scheduled'],
      ['running', 'neutral', '/inbox/campaigns?state=running'],
      ['paused', 'neutral', '/inbox/campaigns?state=paused'],
    ])
    expect(inboxCampaignTiles({ paused: 2 }, links, t)[4]?.tone).toBe('warning')
  })
})
