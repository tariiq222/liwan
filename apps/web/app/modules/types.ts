/**
 * Application manifest: the one place an application declares its web surface.
 * Data only. Manifests import nothing from components; icons are Iconify strings.
 */
export interface AppNavItem {
  to: string; labelKey: string; icon: string; shortcut: string; capability: string
  /** Rail module this item opens; defaults to the manifest id. PMO uses 'home' for the dashboard. */
  module?: string
  /** Optional custom active test, replacing the branches in isNavPathActive. */
  isActive?: (path: string) => boolean
}
export interface AppContextLink { id: string; labelKey: string; icon: string; to: string; capability: string; pinned?: boolean }
export interface AppRailEntry { id: string; labelKey: string; icon: string; to: string; order: number }
export interface AppSearchProvider {
  id: string; labelKey: string; capability: string
  /** Vue-query key + fetcher run through useApi(); returns rows with id and label. */
  search: (api: <T>(url: string) => Promise<T>, q: string) => Promise<Array<{ id: number | string; label: string; to: string; caption?: string }>>
}
export interface AppBellKind { kind: string; href: (row: Record<string, unknown>) => string | null; titleKey?: string }
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
  contextLinks?: (path: string | undefined) => AppContextLink[]  // keyed by rail id via link module in nav
  routeCapabilities?: Array<{ pattern: RegExp; capability: string }>
  landing?: AppLandingEntry[]                                     // firstAllowedPath order within the app
  capabilityAliases?: Record<string, string>                      // chat: { 'nasq.internal': 'chat.enabled' }
  bell?: { capabilities: string[]; kinds?: AppBellKind[] }
  search?: AppSearchProvider[]
  /** Extra paths a post-login `next` may return to, beyond the landing paths. */
  returnToPaths?: string[]
  /**
   * Overrides the default "same path or sub-path" nav match for a target this app owns.
   * Return undefined to fall back to the default for that target.
   */
  isNavActive?: (path: string, target: string) => boolean | undefined
}
