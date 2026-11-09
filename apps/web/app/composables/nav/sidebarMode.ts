export type SidebarMode = 'global' | 'app'

/** Rail ids that are pages of the platform itself, never an application of their own. */
const PLATFORM_PAGES: readonly string[] = ['home', 'apps']

/**
 * The application whose own menu the sidebar shows: the open manifest module or settings, `account` on the
 * self-service pages (their links are that area's menu), and null on the day page, the start pages and the pages
 * no application owns (search, notifications), where the sidebar stays global.
 */
export function sidebarApp(personal: boolean, activeModule: string | null, railIds: readonly string[]): string | null {
  if (personal) return 'account'
  if (!activeModule || PLATFORM_PAGES.includes(activeModule)) return null
  return railIds.includes(activeModule) ? activeModule : null
}

export function sidebarMode(activeId: string | null): SidebarMode {
  return activeId ? 'app' : 'global'
}
