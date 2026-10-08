import type { ZodType } from 'zod'

/**
 * Application manifest: the one place an application declares its web surface.
 * Data only. Manifests import nothing from components; icons are Iconify strings.
 */
/** Iconify name from the local Lucide collection. */
export type AppIcon = `i-lucide-${string}`
export interface AppNavItem {
  to: string; labelKey: string; icon: AppIcon; shortcut: string; capability: string
  /** Rail module this item opens; defaults to the manifest id. PMO uses 'home' for the dashboard. */
  module?: string
}
export interface AppContextLink { id: string; labelKey: string; icon: AppIcon; to: string; capability: string; pinned?: boolean }
export interface AppRailEntry { id: string; labelKey: string; icon: AppIcon; to: string; order: number }
/** The fetcher a search provider receives: `useApi().$api`, so requests keep its cookies, errors and zod parsing. */
export type AppSearchApi = <T>(
  url: string,
  options: { query?: Record<string, unknown>; schema: ZodType<T> },
) => Promise<T>
export interface AppSearchRow { id: number | string; label: string; to: string; caption?: string }
export interface AppSearchPage {
  rows: AppSearchRow[]
  /** Server total for paged providers; omitted when the response is not paged. */
  total?: number
  /** True when the server capped the response, so `truncatedKey` is shown. */
  truncated?: boolean
}
export interface AppSearchProvider {
  id: string; labelKey: string; capability: string
  /** Iconify name of each result row. */
  icon: string
  /**
   * true: the server filters by `q` (query key includes `q`, paged by `offset`, rows wait for the debounce).
   * false: one unfiltered fetch whose rows are filtered by label on the client.
   */
  serverSearch: boolean
  /** Vue-query key; the shared search surface appends nothing. */
  queryKey: (q: string) => readonly unknown[]
  /** Runs through useApi(); `offset` is the number of rows already loaded. Rows link to a path without query. */
  search: (api: AppSearchApi, q: string, offset: number) => Promise<AppSearchPage>
  /** Locale key of the notice shown when a page reports `truncated`. */
  truncatedKey?: string
  /** Rendered on the dialog only (default: dialog and /search page). */
  dialogOnly?: boolean
}
export interface AppBellKind {
  kind: string
  /** Where opening the row goes; null leaves it as mark-read only. */
  href: (row: Record<string, unknown>) => string | null
  /** Row title when it is not the generic one; `t` is the i18n translate function. */
  title?: (row: Record<string, unknown>, t: (key: string, count?: number) => string) => string
}
export interface AppLandingEntry {
  path: string; capability: string
  /** Ordered after the foundation destinations (settings, access) instead of in rail order. */
  late?: boolean
}
export interface AppManifest {
  id: string                         // 'pmo' | 'meetings' | 'hr' | 'chat' | '<app>'
  feature: string                    // '<app>.enabled'
  routePrefixes: string[]            // feature gate + active rail module
  rail: AppRailEntry[]               // usually one; PMO declares 'home' (order 10) and 'projects' (order 20)
  nav: AppNavItem[]
  /**
   * Rail module (and nav group) for an owned path that no nav item claims, and the group of
   * every nav item. Defaults to the manifest id. PMO sets 'projects'.
   */
  defaultRail?: string
  contextLinks?: (path: string | undefined) => AppContextLink[]  // keyed by rail id via link module in nav
  routeCapabilities?: Array<{ pattern: RegExp; capability: string }>
  landing?: AppLandingEntry[]                                     // firstAllowedPath order within the app
  capabilityAliases?: Record<string, string>                      // chat: { 'nasq.internal': 'chat.enabled' }
  bell?: { capabilities: string[]; kinds?: AppBellKind[] }
  search?: AppSearchProvider[]
  /** Extra paths a post-login `next` may return to, beyond the landing paths. */
  returnToPaths?: string[]
  /**
   * The one active-path test for a nav, landing or context-link target this app owns; it overrides
   * the default "same path or sub-path" match. Return undefined to fall back to the default.
   */
  isNavActive?: (path: string, target: string) => boolean | undefined
}
