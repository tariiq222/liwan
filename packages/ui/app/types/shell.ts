import type { RouteLocationRaw } from 'vue-router'

/** One crumb of the header trail; the last one is the current page and carries no link. */
export interface ShellCrumb { label: string; to?: string }

/** One rail entry (an application, home or settings) as the shell models list it; vendor-admin lists its own pages the same way. */
export interface ShellRailItem { id: string; labelKey: string; shortLabelKey?: string; icon: string; to: string }

/** Fixed destinations, the scrollable applications and the utility slot. */
export interface ShellRailGroups { top: ShellRailItem[]; applications: ShellRailItem[]; utility: ShellRailItem[] }

/**
 * One sidebar row: a link, or an action (the create action is `primary`). `app` is an application id: the row then
 * shows that application's coloured icon tile instead of a bare icon.
 */
export interface ShellQuickItem { id: string; label: string; icon: string; to: RouteLocationRaw; active?: boolean; count?: number; primary?: boolean; app?: string }

/** A link row of the sidebar, optionally with nested rows; `testId` is the full Playwright hook of the row. */
export interface ShellNavigationLink extends ShellQuickItem {
  testId: string
  children?: ShellNavigationLink[]
}

export interface ShellSubListSection {
  id: string
  title: string
  items: ShellNavigationLink[]
}

/** One application's destinations and actions: the body of the sidebar while that application is open. */
export interface ShellNavigationItem {
  id: string
  label: string
  icon: string
  to: RouteLocationRaw
  active: boolean
  sections: ShellSubListSection[]
  actions: ShellQuickItem[]
}

/** One destination of the bottom tab bar; an item without `to` is a button («المزيد» opens the drawer). */
export interface ShellTabItem { id: string; label: string; icon: string; to?: string; active: boolean; testId?: string }
