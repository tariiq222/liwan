import type { Component } from 'vue'
import type { ZodType } from 'zod'

/**
 * Application manifest: the one place an application declares its web surface.
 * Data only: manifests import no components, except the lazy `sidebarPanel.load`
 * (a dynamic import of the application's own panel). Icons are Iconify strings.
 */
/** Iconify name from the local Lucide collection. */
export type AppIcon = `i-lucide-${string}`
export interface AppNavItem {
  to: string; labelKey: string; icon: AppIcon; capability: string
  /** One-key jump on the /search page only, not a global shortcut; tools/new_app.py picks a free one. */
  shortcut: string
  /** Letter of the global `G` then letter shortcut: a–z, never g, unique across apps and the foundation (manifests.test.ts). */
  goKey?: string
  /** Rail module this item opens; defaults to the manifest id. PMO uses 'home' for the dashboard. */
  module?: string
}
/** A palette action (Tasmim spec §5, Actions group): opens a route; hidden unless the user may run it. */
export interface AppCommand {
  /** `<manifest id>.<name>`, unique. */
  id: string
  labelKey: string
  icon: AppIcon
  /** The route the command opens, usually a `/new` form; the palette adds `returnTo`. */
  to: string
  /** Checked with its feature and the route's own capability (paletteModel.visibleCommands). */
  capability: string
  /** Display-only key hint beside the command; it binds no key. */
  shortcut?: string
}
export interface AppContextLink {
  id: string; labelKey: string; icon: AppIcon; to: string; capability: string; pinned?: boolean
  /** Locale key of the sidebar section heading; consecutive links with the same key form one section. */
  section?: string
}
export interface AppRailEntry { id: string; labelKey: string; icon: AppIcon; to: string; order: number }
/** The fetcher a search provider receives: `useApi().$api`, so requests keep its cookies, errors and zod parsing. */
export type AppSearchApi = <T>(
  url: string,
  options: { query?: Record<string, unknown>; schema: ZodType<T>; signal?: AbortSignal },
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
/**
 * Content an application shows in the context sidebar of its rail module, below its links
 * (chat: the conversation list). Lazily loaded; the component takes no props and reads the route.
 * On desktop no pinned create action shows beside it, and while the sidebar is expanded the
 * module's links give way to it.
 */
export interface AppSidebarPanel {
  /** Rail module whose sidebar hosts the panel. */
  module: string
  /** 'wide' widens the sidebar to 400px (320px between 768 and 1100px). */
  width: 'default' | 'wide'
  load: () => Promise<{ default: Component }>
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
  /**
   * Dynamic list sources this application owns. A recognized pathname may return a record
   * to that list, after both its normal route access and this additional capability pass.
   * Patterns match complete list paths only; never records, forms or broad prefixes.
   */
  recordListSources?: Array<{ pattern: RegExp; capability: string }>
  landing?: AppLandingEntry[]                                     // firstAllowedPath order within the app
  capabilityAliases?: Record<string, string>                      // chat: { 'webvue.internal': 'chat.enabled' }
  bell?: { capabilities: string[]; kinds?: AppBellKind[] }
  search?: AppSearchProvider[]
  /** Palette actions (Actions group of the command palette). */
  commands?: AppCommand[]
  sidebarPanel?: AppSidebarPanel
  /** Extra paths a post-login `next` may return to, beyond the landing paths. */
  returnToPaths?: string[]
  /**
   * The one active-path test for a nav, landing or context-link target this app owns; it overrides
   * the default "same path or sub-path" match. Return undefined to fall back to the default.
   */
  isNavActive?: (path: string, target: string) => boolean | undefined
}
