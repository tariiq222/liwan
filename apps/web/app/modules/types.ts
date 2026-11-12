import type { Component } from 'vue'
import type { ZodType } from 'zod'

/**
 * Application manifest: the one place an application declares its web surface.
 * Data only: manifests import no components, except the lazy `quickPanel.load`
 * and `assistant.load` (dynamic imports of the application's own panel body). Icons are Iconify strings.
 */
/** Local Lucide icons, the approved customer WhatsApp brand icon and the Liwan AI sparkle. */
export type AppIcon = `i-lucide-${string}` | 'i-liwan-whatsapp' | 'i-lucide-sparkles'
/**
 * `feature` on a nav item, context link or route rule: an extra sub-feature key (e.g. 'hr.assets') the
 * entry needs on top of its capability and the feature derived from it, at the same read/write level.
 * For an entry whose capability belongs to another area (own custody is an employee read).
 */
export interface AppNavItem {
  to: string; labelKey: string; icon: AppIcon; capability: string
  anyCapabilities?: string[]
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
  anyCapabilities?: string[]
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
  /** Further capabilities that also open the part, for a page that serves two rights (branch creation and branch access policy). */
  anyCapabilities?: string[]
  to?: string
  within?: string
  /** Palette/search target when the card's `within` is a directory without a page (the channels list); defaults to `to ?? within ?? page + anchor`. */
  navTo?: string
}
/**
 * One tab of a long settings page: its label and the parts it shows. A page with groups shows one tab per group; a
 * part listed in no group sits above the tabs on every tab; every listed part id must exist in `parts`.
 */
export interface AppSettingsGroup {
  id: string
  labelKey: string
  parts: string[]
}
/**
 * The one settings page an application registers under Settings > Applications (`/settings/apps/<app>` or a path
 * beneath it). `to` owns its whole subtree for route access; the first part's capability opens the page itself.
 */
export interface AppSettingsPage {
  id: string; labelKey: string; icon: AppIcon
  to: string
  parts: AppSettingsPart[]
  /** Tabs of a long page; absent when every part is one scrolled list. */
  groups?: AppSettingsGroup[]
}
/**
 * `shortLabelKey` names the entry under its rail icon when the full label (still the tooltip) needs two lines.
 * `core` marks a free base-system application: the icon row under the organisation always lists it (ascending, after
 * «يومي»), whatever the user pins, and it takes no pin of its own.
 */
export interface AppRailEntry { id: string; labelKey: string; shortLabelKey?: string; icon: AppIcon; to: string; order: number; core?: number }
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
 * A personal tool the application adds to the top bar (chat: recent conversations, tasks: my open tasks,
 * meetings: the upcoming ones). The button shows `count` as its badge and opens a slide-over whose body is the
 * application's own component, loaded lazily so the shell imports no application code (R3). The body takes no props.
 */
export interface AppQuickPanel {
  /** Unique across manifests; names the slide-over and its test ids. */
  id: string
  labelKey: string
  icon: AppIcon
  /** Capability that shows the button and the panel (with the application's feature). */
  capability: string
  /** The page «افتح الكل» goes to. */
  to: string
  /** Vue-query key of the badge count; the surfaces append nothing. */
  queryKey: readonly unknown[]
  /** The badge number; runs through useApi() with the caller's session. */
  count: (api: AppSearchApi) => Promise<number>
  load: () => Promise<{ default: Component }>
}
/**
 * The assistant's sheet: a panel the shell hosts beside the page, opened from a header button. The body is
 * the owning application's own component, loaded lazily so the shell imports no application code (R3).
 */
export interface AppAssistantSurface {
  /** Capability that shows the header button and the sheet. */
  capability: string
  labelKey: string
  /** The full page the sheet's "open full page" link goes to. */
  to: string
  load: () => Promise<{ default: Component }>
}
/** One thing an application says needs the user's attention; `to` opens the record. */
export interface AppAttentionRow {
  /** Shared record identity when applications expose the same record through different links. */
  recordKey?: string
  id: string
  label: string
  to: string
  /** One short line under the label (a due date, a status). */
  caption?: string
  /** `urgent` is overdue or waiting on the user's decision; it leads the list and is drawn warm. */
  tone: 'urgent' | 'normal'
  /** How close the deadline is, for a row that has one: the home rail colours its chip by it. */
  due?: 'overdue' | 'today' | 'soon'
  /** What the user could do next, translated; shown as a plain suggestion, never as an action the assistant takes. */
  suggestion?: string
}
/** The three kinds of work the user's own page groups rows by. */
export type AppWorkKind = 'execute' | 'decide' | 'follow'
/**
 * What an application tells the assistant surfaces (the sheet's "this page now", the full page's morning summary,
 * the home suggestions). Built only from the application's own existing endpoints, through the caller's session.
 */
export interface AppAttentionProvider {
  id: string
  /** Rail module this provider belongs to; the sheet shows the providers of the module the user is in. */
  module: string
  /** What the row asks of the user: do it (`execute`), decide on it (`decide`), or keep an eye on it (`follow`). Drives "my work". */
  work: AppWorkKind
  capability: string
  /** Vue-query key; the surfaces append nothing. */
  queryKey: readonly unknown[]
  /** Runs through useApi(); `t` is the i18n translate function for `suggestion`. Returns at most a handful of rows. */
  load: (api: AppSearchApi, t: (key: string, params?: Record<string, unknown>) => string) => Promise<AppAttentionRow[]>
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
  /**
   * The server serves this page, and the pages beneath its `to`, from the account's home company whatever company the session
   * works in, so its navigation entry, route gate and in-page checks follow the capabilities held there (`home_capabilities`).
   * Declare it only for the routes the server marks `serves_own_data`; an entry without it follows the working company.
   */
  servedFromHomeCompany?: true
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
/** One live number on an application's card on the home page; a failed or pending figure is simply not drawn. */
export interface AppCardFigure {
  /** Locale key of the caption under the number. */
  labelKey: string
  /** Capability the number needs, when the application's own pages are open to someone who may not read it. */
  capability?: string
  /** Vue-query key; the card appends the owner. */
  queryKey: readonly unknown[]
  /** Runs through useApi(); null when the endpoint has nothing to say. */
  load: (api: AppSearchApi) => Promise<number | null>
}
/** The gradient of an application's card (owner design); the colours live in `components/home/appCardSurface.ts`. */
export type AppCardSurface = 'navy' | 'mint' | 'lav' | 'sand' | 'indigo' | 'coral' | 'forest' | 'lime'
/** How an application shows on the home page «تطبيقاتك» and on the all-applications page. */
export interface AppCard {
  /** The filter chip that lists the card. */
  category: 'sales' | 'team'
  /** `included` (free, ink identity) under «الأساسية», `addon` (paid, its own colour) under «الإضافية». */
  plan: 'included' | 'addon'
  /** Defaults to `lav`. */
  surface?: AppCardSurface
  /** At most two numbers, built only from the application's existing endpoints. */
  figures?: readonly AppCardFigure[]
}
/** The page the sidebar rows read to tell which one the open page belongs to. */
export interface AppSidebarRoute { path: string; query: Record<string, unknown> }
/** One flat row of an application's sidebar. */
export interface AppSidebarRow {
  /** Unique within the menu; names the row's test id and the key of its count. */
  id: string
  labelKey: string
  icon: AppIcon
  /** The path and the query that selects a preset of its list. */
  to: { path: string; query?: Record<string, string> }
  /** Query keys of the open page carried over when it is already on `to.path` (the layout switch, `view`). */
  keep?: readonly string[]
  capability: string
  /** Whether the open page belongs to this row. */
  active: (route: AppSidebarRoute) => boolean
}
/** The numbers beside rows: one request fills the counts of every row id it returns; a failed or pending one is not drawn. */
export interface AppSidebarCounts {
  /** Capability the numbers need; without it nothing is asked. */
  capability: string
  /** Vue-query key; the sidebar appends the owner. */
  queryKey: readonly unknown[]
  /** Runs through useApi(); the count of each row id, null when the endpoint has nothing to say. */
  load: (api: AppSearchApi) => Promise<Record<string, number | null>>
}
/** The records the person opened last (`RECENT_RECORDS_MAX` of them), listed under their own heading; kept in this browser per person and company. */
export interface AppSidebarRecent {
  /** Record kind; names the browser storage. */
  kind: string
  titleKey: string
  icon: AppIcon
  /** Capability that opens the records. */
  capability: string
  /** The record is open when the path is its `to` or beneath it. */
  to: (id: number) => string
}
/**
 * A flat sidebar menu: the application's primary create action (the id of its pinned context link), its pages one
 * level deep with optional counts, and the records opened last. An application without one keeps the generic
 * context-link menu.
 */
export interface AppSidebarMenu {
  create: string
  rows: readonly AppSidebarRow[]
  counts?: readonly AppSidebarCounts[]
  recent?: AppSidebarRecent
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
  capabilityAliases?: Record<string, string>                      // chat: { 'liwan.internal': 'chat.enabled' }
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
  /** A top-bar tool with a slide-over panel (a personal list and its badge). */
  quickPanel?: AppQuickPanel
  /** The assistant's header button and sheet; only the assistant application declares it. */
  assistant?: AppAssistantSurface
  /** What needs the user's attention, for the assistant surfaces and the home suggestions. */
  attention?: AppAttentionProvider[]
  /** A flat sidebar menu in place of the generic one built from `contextLinks`. */
  sidebar?: AppSidebarMenu
  /** The application's card on home and on the all-applications page. */
  appCard?: AppCard
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
