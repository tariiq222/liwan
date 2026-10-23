import type { Component } from 'vue'
import type { ZodType } from 'zod'

/**
 * Application manifest: the one place an application declares its web surface.
 * Data only: manifests import no components, except the lazy `sidebarPanel.load`
 * (a dynamic import of the application's own panel). Icons are Iconify strings.
 */
/** Iconify name from the local Lucide collection. */
export type AppIcon = `i-lucide-${string}`
/**
 * `feature` on a nav item, context link or route rule: an extra sub-feature key (e.g. 'hr.assets') the
 * entry needs on top of its capability and the feature derived from it, at the same read/write level.
 * For an entry whose capability belongs to another area (own custody is an employee read).
 */
export interface AppNavItem {
  to: string; labelKey: string; icon: AppIcon; capability: string
  feature?: string
  /** One-key jump on the /search page only, not a global shortcut; tools/new_app.py picks a free one. An application takes one key (its landing item); its other items pass '' so the single-key space lasts as applications grow. */
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
  id: string; labelKey: string; icon: AppIcon; to: string; capability: string; feature?: string; pinned?: boolean
  /** Locale key of the sidebar section heading; consecutive links with the same key form one section. */
  section?: string
  /** Active only on exactly this path (a section's overview page). */
  exact?: boolean
  /** Path prefix that marks the link active, when it is not the link's own target (a top link that stays lit across its section's sub-list). */
  within?: string
}
/**
 * One card on a settings page. The sidebar sub-list scrolls to the card (its id is the DOM id and the URL hash), or
 * opens `to` when the part is its own page. `within` is the path prefix of the part's full list page, so the part
 * stays lit there.
 */
export interface AppSettingsPart {
  id: string; labelKey: string; icon: AppIcon; capability: string
  to?: string
  within?: string
}
/**
 * The one settings page an application registers under Settings > Applications (`/settings/apps/<app>` or a path
 * beneath it). `to` owns its whole subtree for route access; the first part's capability opens the page itself.
 */
export interface AppSettingsPage {
  id: string; labelKey: string; icon: AppIcon
  to: string
  parts: AppSettingsPart[]
}
/** `shortLabelKey` names the entry under its rail icon when the full label (still the tooltip) needs two lines. */
export interface AppRailEntry { id: string; labelKey: string; shortLabelKey?: string; icon: AppIcon; to: string; order: number }
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
/** One thing an application says needs the user's attention; `to` opens the record. */
export interface AppAttentionRow {
  id: string
  label: string
  to: string
  /** One short line under the label (a due date, a status). */
  caption?: string
  /** `urgent` is overdue or waiting on the user's decision; it leads the list and is drawn warm. */
  tone: 'urgent' | 'normal'
  /** What the user could do next, translated; shown as a plain suggestion, never as an action the assistant takes. */
  suggestion?: string
}
/** One self-service entry an application offers the signed-in user; `to` opens the page that does it. */
export type PersonalSection = 'profile' | 'leave' | 'requests' | 'pay' | 'assets' | 'documents' | 'schedule'
export interface AppPersonalSummary {
  value?: string
  caption?: string
  rows?: AppSearchRow[]
  attention?: AppAttentionRow[]
}
export interface AppPersonalEntry {
  id: string
  labelKey: string
  descriptionKey: string
  icon: AppIcon
  to: string
  /** Capability that opens the target; the entry is hidden without it (and without the application feature). */
  capability: string

  section: PersonalSection
  feature?: string
  requiredCapabilities?: string[]
  primaryAction?: AppCommand
  summary?: {
    queryKey: readonly unknown[]
    load: (api: AppSearchApi, t: (key: string, params?: Record<string, unknown>) => string) => Promise<AppPersonalSummary>
  }
}
/** A record one application lets another application pick or filter by. */
export interface AppRecordOption { id: number; name: string }
/**
 * A kind of record other applications may pick or filter by (the project a meeting belongs to). The
 * application that owns the kind declares it, so no other application imports that application's code.
 */
export interface AppRecordPicker {
  /** Record kind, unique across manifests. */
  kind: string
  /** Capability that reads the options; without it the picker is unavailable. */
  capability: string
  /** Capability to create a task in a picked record; absent when the kind cannot hold tasks. */
  taskCapability?: string
  /** Vue-query key of the options, so the owning application's writes refresh them. */
  queryKey: readonly unknown[]
  /** Every option, walking server pages itself; runs through useApi(). */
  options: (api: AppSearchApi, signal?: AbortSignal) => Promise<AppRecordOption[]>
}
/**
 * Where a record of one application opens, declared by the application that owns the route so another
 * application links to it by kind without naming its path or capability.
 */
export interface AppRecordLink {
  /** Record kind, unique across manifests. */
  kind: string
  /** Capability that reads the record; without it (or its feature) there is no link. */
  capability: string
  to: (id: number) => string
}
/** The record a route lives inside, such as the project at `/projects/7/tasks`. */
export interface AppRouteScope {
  /** Record kind; the same names the record pickers use. */
  kind: string
  /** Id of the record `path` lives inside, or null for a path outside every such record. */
  idFromPath: (path: string) => number | null
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
  /** The configuration page this application adds to Settings > Applications. */
  settings?: AppSettingsPage
  contextLinks?: (path: string | undefined) => AppContextLink[]  // keyed by rail id via link module in nav
  routeCapabilities?: Array<{ pattern: RegExp; capability: string; feature?: string; anyCapabilities?: string[]; requiredCapabilities?: string[] }>
  /**
   * Dynamic list sources this application owns. A recognized pathname may return a record
   * to that list, after both its normal route access and this additional capability pass.
   * Patterns match complete list paths only; never records, forms or broad prefixes.
   */
  recordListSources?: Array<{ pattern: RegExp; capability: string }>
  landing?: AppLandingEntry[]                                     // firstAllowedPath order within the app
  capabilityAliases?: Record<string, string>                      // chat: { 'webvue.internal': 'chat.enabled' }
  /**
   * Capability prefix → feature key for an application whose areas are features of their
   * own, e.g. hr's `{ 'hr.recruitment.': 'hr.recruitment' }`. A capability that matches a
   * declared prefix needs the application feature and the matched sub-feature, both at
   * the capability's own read/write level; `capabilityAliases` cannot express that (it
   * forces read semantics).
   */
  subFeatures?: Record<string, string>
  bell?: { capabilities: string[]; kinds?: AppBellKind[] }
  search?: AppSearchProvider[]
  /** Palette actions (Actions group of the command palette). */
  commands?: AppCommand[]
  sidebarPanel?: AppSidebarPanel
  /** Employee-owned services, separate from work and administrative navigation. */
  personal?: AppPersonalEntry[]
  /** Record kinds other applications may pick or filter by. */
  recordPickers?: AppRecordPicker[]
  /** Record kinds other applications may link to. */
  recordLinks?: AppRecordLink[]
  /** Records whose routes this application owns, so the shell can tell which record a path lives inside. */
  routeScopes?: AppRouteScope[]
  /** Extra paths a post-login `next` may return to, beyond the landing paths. */
  returnToPaths?: string[]
  /**
   * The one active-path test for a nav, landing or context-link target this app owns; it overrides
   * the default "same path or sub-path" match. Return undefined to fall back to the default.
   */
  isNavActive?: (path: string, target: string) => boolean | undefined
}
