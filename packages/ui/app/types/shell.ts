import type { RouteLocationRaw } from 'vue-router'

/** One crumb of the header trail; the last one is the current page and carries no link. */
export interface ShellCrumb { label: string; to?: string }

/** One rail entry (an application, home or settings) as the shell models list it; vendor-admin lists its own pages the same way. */
export interface ShellRailItem { id: string; labelKey: string; shortLabelKey?: string; icon: string; to: string }

/** Fixed destinations, the scrollable applications and the utility slot. */
export interface ShellRailGroups { top: ShellRailItem[]; applications: ShellRailItem[]; utility: ShellRailItem[] }

/**
 * One sidebar row: a link, or an action (the create action is `primary`). `app` is an application id: the row then
 * shows that application's coloured icon tile instead of a bare icon. `count` draws a badge only when positive (capped at
 * `99+`); zero or absent draws nothing.
 */
export interface ShellQuickItem { id: string; label: string; icon: string; to: RouteLocationRaw; active?: boolean; count?: number; primary?: boolean; app?: string }

/** One icon button of the sidebar's bottom row: a link when `to` is set, a plain button otherwise. */
export interface ShellFooterTool { id: string; label: string; icon: string; to?: RouteLocationRaw; active?: boolean }

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

/** One row of the application switch menu: the application id (for its coloured tile), its name, icon and page. */
export interface ShellAppSwitchItem { id: string; label: string; icon: string; to: RouteLocationRaw; testId?: string }

/** One destination of the bottom tab bar; an item without `to` is a button («المزيد» opens the drawer). */
export interface ShellTabItem { id: string; label: string; icon: string; to?: string; active: boolean; testId?: string; /** The unread or open count the sidebar's core row shows for the same application. */ count?: number }
