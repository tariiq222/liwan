import type { RouteLocationRaw } from 'vue-router'
import { clientStateFilters, CLIENT_LIST_PAGE_SIZE, type ClientRow } from '@nasq/commercial-contracts'

// ---- The unified client list (URL-backed filters) ----
export const CLIENT_STATE_FILTERS = ['all', ...clientStateFilters] as const
export type ClientStateFilter = (typeof CLIENT_STATE_FILTERS)[number]
export const isClientStateFilter = (v: unknown): v is ClientStateFilter => typeof v === 'string' && (CLIENT_STATE_FILTERS as readonly string[]).includes(v)
export const CLIENT_PAGE_SIZE = CLIENT_LIST_PAGE_SIZE

export function clientListQuery(p: { q?: string; state?: string; page: number }) {
  return { q: p.q || undefined, state: p.state && p.state !== 'all' ? p.state : undefined, page: p.page > 1 ? p.page : undefined }
}

/** A client opens on its customer page, or on its workspace page when it has no commercial record. */
export function clientTo(row: Pick<ClientRow, 'customer_id' | 'tenant_id'>, returnTo: string): RouteLocationRaw {
  return { path: row.customer_id ? `/customers/${encodeURIComponent(row.customer_id)}` : `/tenants/${encodeURIComponent(row.tenant_id!)}`, query: { returnTo } }
}

// ---- Record tabs (the `tab` query) ----
export const CUSTOMER_TABS = ['summary', 'subscription', 'invoices', 'workspace', 'operations', 'history'] as const
export const TENANT_TABS = ['summary', 'workspace', 'operations'] as const
export type ClientTab = (typeof CUSTOMER_TABS)[number]

/** The tab named by the URL when this page offers it, else the summary. */
export function clientTab(value: unknown, offered: readonly ClientTab[]): ClientTab {
  const raw = Array.isArray(value) ? value[0] : value
  return offered.find(tab => tab === raw) ?? 'summary'
}

/** Route-tab items: each keeps the other query keys (the return target) and sets `tab`; the summary carries none. */
export function clientTabItems(offered: readonly ClientTab[], active: ClientTab, route: { path: string; query: Record<string, unknown> }, label: (tab: ClientTab) => string, testIdPrefix: string) {
  return offered.map(tab => ({
    key: `${testIdPrefix}-${tab}`, label: label(tab), active: tab === active,
    to: { path: route.path, query: { ...route.query, tab: tab === 'summary' ? undefined : tab } },
  }))
}
