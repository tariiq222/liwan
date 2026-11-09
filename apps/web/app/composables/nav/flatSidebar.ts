import type { ShellNavigationLink, ShellQuickItem, ShellSubListSection } from '@liwan/ui/app/types/shell'
// Relative imports: this module is unit-tested directly under plain vitest.
import type { AppSidebarMenu, AppSidebarRoute } from '../../modules/types'
import { normalizedPath } from '../../utils/routePath'
import type { RecentRecord } from './recentRecords'

export interface FlatSidebarInput {
  menu: AppSidebarMenu
  route: AppSidebarRoute
  /** Whether the identity may open a destination: its capability and, for a path, the route's own access. */
  canOpen: (capability: string, path?: string) => boolean
  /** The menu's create action, already resolved by the shell (it carries the return path); null when the person may not create. */
  create: ShellQuickItem | null
  /** The numbers that have arrived, by row id. */
  counts: Readonly<Record<string, number | undefined>>
  recents: readonly RecentRecord[]
  translate: (key: string) => string
}

export interface FlatSidebar { actions: ShellQuickItem[]; sections: ShellSubListSection[] }

function firstValue(value: unknown): string | undefined {
  const first = Array.isArray(value) ? value[0] : value
  return typeof first === 'string' ? first : undefined
}
const insidePath = (path: string, target: string) => path === target || path.startsWith(`${target}/`)

/**
 * A flat application menu: the create action, then the pages in one level (each lit by its own test, with the count
 * that has arrived), then the records opened last. There are no branches to expand.
 */
export function flatSidebar(input: FlatSidebarInput): FlatSidebar {
  const { menu, route } = input
  const currentPath = normalizedPath(route.path)
  const rows: ShellNavigationLink[] = menu.rows
    .filter(row => input.canOpen(row.capability, row.to.path))
    .map((row) => {
      const kept = currentPath === row.to.path
        ? Object.fromEntries((row.keep ?? []).flatMap((key) => { const value = firstValue(route.query[key]); return value === undefined ? [] : [[key, value] as const] }))
        : {}
      const query = { ...row.to.query, ...kept }
      return {
        id: row.id, label: input.translate(row.labelKey), icon: row.icon,
        to: Object.keys(query).length ? { path: row.to.path, query } : row.to.path,
        active: row.active(route), count: input.counts[row.id], testId: `context-link-${row.id}`,
      }
    })
  const sections: ShellSubListSection[] = [{ id: 'pages', title: '', items: rows }]
  const recent = menu.recent
  if (recent && input.recents.length && input.canOpen(recent.capability)) {
    sections.push({
      id: `recent-${recent.kind}`, title: input.translate(recent.titleKey),
      items: input.recents.map(record => ({
        id: `recent-${recent.kind}-${record.id}`, label: record.name, icon: recent.icon, to: recent.to(record.id),
        active: insidePath(currentPath, recent.to(record.id)), testId: `recent-${recent.kind}-${record.id}`,
      })),
    })
  }
  return { actions: input.create ? [input.create] : [], sections }
}
