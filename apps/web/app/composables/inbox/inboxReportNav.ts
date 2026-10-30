import type { LocationQuery, RouteLocationRaw } from 'vue-router'

export type ReportTabId = 'overview' | 'costs' | 'templates'
export const REPORTS_PATH = '/inbox/reports'

const PATHS: Record<ReportTabId, string> = { overview: REPORTS_PATH, costs: `${REPORTS_PATH}/costs`, templates: `${REPORTS_PATH}/templates` }
/** The filters every report understands; the department and agent narrow only the overview. */
const SHARED_FILTERS = ['period', 'from', 'to', 'channel_id'] as const

const trimmed = (path: string) => path.replace(/\/+$/, '') || '/'

/** Whether `path` is inside the reports area (the sidebar then shows the report sections instead of the conversation list). */
export const isReportsPath = (path: string) => trimmed(path) === REPORTS_PATH || trimmed(path).startsWith(`${REPORTS_PATH}/`)

export function activeReportTab(path: string): ReportTabId {
  const current = trimmed(path)
  return current.startsWith(PATHS.costs) ? 'costs' : current.startsWith(PATHS.templates) ? 'templates' : 'overview'
}

/** One tab link: the shared filters travel with it, the rest is dropped. */
export function reportTabs(path: string, query: LocationQuery): Array<{ id: ReportTabId; to: RouteLocationRaw; active: boolean }> {
  const active = activeReportTab(path)
  const kept = Object.fromEntries(SHARED_FILTERS.flatMap(key => query[key] === undefined ? [] : [[key, query[key]]]))
  return (Object.keys(PATHS) as ReportTabId[]).map(id => ({ id, active: id === active, to: { path: PATHS[id], query: kept } }))
}
