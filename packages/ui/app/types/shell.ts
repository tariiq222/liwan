import type { RouteLocationRaw } from 'vue-router'

/** One crumb of the header trail; the last one is the current page and carries no link. */
export interface ShellCrumb { label: string; to?: string }

/** The closed set of hues an application can take; each has a `--accent-<name>-bg` / `-fg` pair in tokens.css. */
export type AccentName = 'blue' | 'violet' | 'teal' | 'sky' | 'amber' | 'rose' | 'orange' | 'indigo' | 'slate'

/** One rail entry as the module rail and the mobile drawer render it. */
export interface ShellRailItem { id: string; labelKey: string; icon: string; to: string; accent?: AccentName }

/** One row of the quick views card: a preset link (`primary` unset) or an action (the create action is `primary`). */
export interface ShellQuickItem { id: string; label: string; icon: string; to: RouteLocationRaw; active?: boolean; count?: number; primary?: boolean }
