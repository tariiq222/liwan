import type { RouteLocationRaw } from 'vue-router'

/** One crumb of the header trail; the last one is the current page and carries no link. */
export interface ShellCrumb { label: string; to?: string }

/** One rail entry as the module rail and the mobile drawer render it. */
export interface ShellRailItem { id: string; labelKey: string; icon: string; to: string }

/** One row of the quick views card: a preset link (`primary` unset) or an action (the create action is `primary`). */
export interface ShellQuickItem { id: string; label: string; icon: string; to: RouteLocationRaw; active?: boolean; count?: number; primary?: boolean }

/** A titled run of links in the sub-list card; `testId` is the full Playwright hook of each row. */
export interface ShellSubListSection { id: string; title: string; items: Array<ShellQuickItem & { testId: string }> }
