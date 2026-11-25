import { kpiLink } from '@liwan/ui/app/utils/kpiLink'
import type { KpiTile } from '@liwan/ui/app/utils/kpiTile'

type Translate = (key: string) => string

/**
 * The scope filters the KPI tiles keep besides their own dimension: the search and the secondary filters of the list.
 * The owner and the state are each tile's own dimension, so they are never carried over from the page.
 */
export interface InboxConversationKpiScope {
  q?: string
  priority?: string
  channel?: string
  channelId?: number | null
  departmentId?: number | null
  csat?: string
  unreadOnly?: boolean
}

export interface InboxOrderKpiScope {
  q?: string
  channelId?: number | null
}

export interface InboxCampaignKpiScope {
  q?: string
  channelId?: number | null
}

export const INBOX_CONVERSATION_KPI_KEYS = ['open', 'pending', 'unassigned', 'mine'] as const
export type InboxConversationKpiKey = typeof INBOX_CONVERSATION_KPI_KEYS[number]

export const INBOX_ORDER_KPI_KEYS = ['total', 'cart', 'ordered', 'paid'] as const
export type InboxOrderKpiKey = typeof INBOX_ORDER_KPI_KEYS[number]

export const INBOX_CAMPAIGN_KPI_KEYS = ['total', 'draft', 'scheduled', 'running', 'paused'] as const
export type InboxCampaignKpiKey = typeof INBOX_CAMPAIGN_KPI_KEYS[number]

type Query = Record<string, string | number>

/** The conversation filters the tiles share; the API names the channel kind `channel_kind`. */
function conversationScope(scope: InboxConversationKpiScope): Query {
  return {
    ...(scope.q ? { q: scope.q } : {}),
    ...(scope.priority ? { priority: scope.priority } : {}),
    ...(scope.channel ? { channel_kind: scope.channel } : {}),
    ...(scope.channelId ? { channel_id: scope.channelId } : {}),
    ...(scope.departmentId ? { department_id: scope.departmentId } : {}),
    ...(scope.csat ? { csat: scope.csat } : {}),
    ...(scope.unreadOnly ? { unread: 'true' } : {}),
  }
}

/** The same scope as the inbox list URL reads it (`channel`, not `channel_kind`). */
function conversationLinkScope(scope: InboxConversationKpiScope): Record<string, string | number | boolean | undefined> {
  return {
    q: scope.q || undefined,
    priority: scope.priority || undefined,
    channel: scope.channel || undefined,
    channel_id: scope.channelId ?? undefined,
    department_id: scope.departmentId ?? undefined,
    csat: scope.csat || undefined,
    unread: scope.unreadOnly || undefined,
  }
}

/**
 * The `limit=1` conversation queries of the tiles: open, pending, open and unassigned, and open assigned to the viewer.
 * The API has no "overdue" filter, so the longest-waiting total cannot be one of these counts.
 */
export function inboxConversationKpiFilters(scope: InboxConversationKpiScope): Record<InboxConversationKpiKey, Query> {
  const base = conversationScope(scope)
  return {
    open: { ...base, state: 'open', limit: 1 },
    pending: { ...base, state: 'pending', limit: 1 },
    unassigned: { ...base, state: 'open', assignee: 'unassigned', limit: 1 },
    mine: { ...base, state: 'open', assignee: 'me', limit: 1 },
  }
}

/** The inbox list link of each tile, keeping the scope filters; `base` clears the tile's own filters. */
export function inboxConversationKpiLinks(scope: InboxConversationKpiScope): Record<InboxConversationKpiKey | 'base', string> {
  const base = conversationLinkScope(scope)
  return {
    base: kpiLink('/inbox', base),
    open: kpiLink('/inbox', { ...base, state: 'open' }),
    pending: kpiLink('/inbox', { ...base, state: 'pending' }),
    unassigned: kpiLink('/inbox', { ...base, state: 'open', assignee: 'unassigned' }),
    mine: kpiLink('/inbox', { ...base, state: 'open', assignee: 'me' }),
  }
}

/** The four tiles of the conversations page; a count that has not arrived yet renders as "—". */
export function inboxConversationTiles(
  counts: Partial<Record<InboxConversationKpiKey, number>>,
  links: Record<InboxConversationKpiKey | 'base', string>,
  t: Translate,
): KpiTile[] {
  return [
    { id: 'open', label: t('inbox.states.open'), icon: 'i-lucide-messages-square', tone: 'neutral', value: counts.open ?? null, to: links.open, clearTo: links.base },
    { id: 'pending', label: t('inbox.states.pending'), icon: 'i-lucide-hourglass', tone: counts.pending ? 'warning' : 'neutral', value: counts.pending ?? null, to: links.pending, clearTo: links.base },
    { id: 'unassigned', label: t('inbox.unassigned'), icon: 'i-lucide-user-x', tone: counts.unassigned ? 'warning' : 'neutral', value: counts.unassigned ?? null, to: links.unassigned, clearTo: links.base },
    { id: 'mine', label: t('inbox.kpi.mine'), icon: 'i-lucide-user-round-check', tone: 'neutral', value: counts.mine ?? null, to: links.mine, clearTo: links.base },
  ]
}

/** The `limit=1` order queries of the tiles: every order, the carts, the placed orders and the paid ones. */
export function inboxOrderKpiFilters(scope: InboxOrderKpiScope): Record<InboxOrderKpiKey, Query> {
  const base: Query = {
    ...(scope.q ? { q: scope.q } : {}),
    ...(scope.channelId ? { channel_id: scope.channelId } : {}),
  }
  return {
    total: { ...base, limit: 1 },
    cart: { ...base, state: 'cart', limit: 1 },
    ordered: { ...base, state: 'ordered', limit: 1 },
    paid: { ...base, payment_status: 'paid', limit: 1 },
  }
}

/** The orders list link of each tile, keeping the search and the channel; `base` clears the tile's own filter. */
export function inboxOrderKpiLinks(scope: InboxOrderKpiScope): Record<InboxOrderKpiKey | 'base', string> {
  const base = { q: scope.q || undefined, channel_id: scope.channelId ?? undefined }
  return {
    base: kpiLink('/inbox/orders', base),
    total: kpiLink('/inbox/orders', base),
    cart: kpiLink('/inbox/orders', { ...base, state: 'cart' }),
    ordered: kpiLink('/inbox/orders', { ...base, state: 'ordered' }),
    paid: kpiLink('/inbox/orders', { ...base, payment_status: 'paid' }),
  }
}

/** The four tiles of the orders list; `total` has no filter of its own, so it has no `clearTo`. */
export function inboxOrderTiles(
  counts: Partial<Record<InboxOrderKpiKey, number>>,
  links: Record<InboxOrderKpiKey | 'base', string>,
  t: Translate,
): KpiTile[] {
  return [
    { id: 'total', label: t('inbox.orders.kpi.total'), icon: 'i-lucide-shopping-cart', tone: 'neutral', value: counts.total ?? null, to: links.total },
    { id: 'cart', label: t('inbox.orders.kpi.cart'), icon: 'i-lucide-shopping-basket', tone: counts.cart ? 'warning' : 'neutral', value: counts.cart ?? null, to: links.cart, clearTo: links.base },
    { id: 'ordered', label: t('inbox.orders.kpi.ordered'), icon: 'i-lucide-package-check', tone: 'neutral', value: counts.ordered ?? null, to: links.ordered, clearTo: links.base },
    { id: 'paid', label: t('inbox.orders.payment.paid'), icon: 'i-lucide-badge-check', tone: counts.paid ? 'success' : 'neutral', value: counts.paid ?? null, to: links.paid, clearTo: links.base },
  ]
}

/** The `limit=1` campaign queries of the tiles: every campaign and each live state. */
export function inboxCampaignKpiFilters(scope: InboxCampaignKpiScope): Record<InboxCampaignKpiKey, Query> {
  const base: Query = {
    ...(scope.q ? { q: scope.q } : {}),
    ...(scope.channelId ? { channel_id: scope.channelId } : {}),
  }
  return {
    total: { ...base, limit: 1 },
    draft: { ...base, state: 'draft', limit: 1 },
    scheduled: { ...base, state: 'scheduled', limit: 1 },
    running: { ...base, state: 'running', limit: 1 },
    paused: { ...base, state: 'paused', limit: 1 },
  }
}

/** The campaigns list link of each tile; `base` clears the state filter. */
export function inboxCampaignKpiLinks(scope: InboxCampaignKpiScope): Record<InboxCampaignKpiKey | 'base', string> {
  const base = { q: scope.q || undefined, channel_id: scope.channelId ?? undefined }
  return {
    base: kpiLink('/inbox/campaigns', base),
    total: kpiLink('/inbox/campaigns', base),
    draft: kpiLink('/inbox/campaigns', { ...base, state: 'draft' }),
    scheduled: kpiLink('/inbox/campaigns', { ...base, state: 'scheduled' }),
    running: kpiLink('/inbox/campaigns', { ...base, state: 'running' }),
    paused: kpiLink('/inbox/campaigns', { ...base, state: 'paused' }),
  }
}

/** The five tiles of the campaigns list; only the paused figure is coloured, as the one that asks for an action. */
export function inboxCampaignTiles(
  counts: Partial<Record<InboxCampaignKpiKey, number>>,
  links: Record<InboxCampaignKpiKey | 'base', string>,
  t: Translate,
): KpiTile[] {
  return [
    { id: 'total', label: t('inbox.campaigns.kpi.total'), icon: 'i-lucide-megaphone', tone: 'neutral', value: counts.total ?? null, to: links.total },
    { id: 'draft', label: t('inbox.campaigns.states.draft'), icon: 'i-lucide-file-pen-line', tone: 'neutral', value: counts.draft ?? null, to: links.draft, clearTo: links.base },
    { id: 'scheduled', label: t('inbox.campaigns.states.scheduled'), icon: 'i-lucide-calendar-clock', tone: 'neutral', value: counts.scheduled ?? null, to: links.scheduled, clearTo: links.base },
    { id: 'running', label: t('inbox.campaigns.states.running'), icon: 'i-lucide-send', tone: 'neutral', value: counts.running ?? null, to: links.running, clearTo: links.base },
    { id: 'paused', label: t('inbox.campaigns.states.paused'), icon: 'i-lucide-circle-pause', tone: counts.paused ? 'warning' : 'neutral', value: counts.paused ?? null, to: links.paused, clearTo: links.base },
  ]
}
