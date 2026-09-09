import { projectListReturnTo } from './projectNavigation'

export interface ProjectLocation { path: string; query: Record<string, string> }
const keys = ['tab', 'view', 'q', 'state', 'closed', 'kind', 'status', 'priority', 'offset', 'role', 'scale', 'type', 'category_id', 'date_from', 'date_to', 'task_q', 'stakeholder_q', 'task_page', 'stakeholder_page']

/** Only browseable sections are eligible; never reopen a form or record. */
export function savedProjectLocation(path: string, query: Record<string, unknown>): ProjectLocation | null {
  if (!/^\/projects\/[1-9]\d*(?:\/(register|stakeholders|raci|finance|charter|schedule|updates))?$/.test(path) || query.edit != null) return null
  const clean: Record<string, string> = {}
  for (const key of keys) if (typeof query[key] === 'string' && query[key].length <= 1000) clean[key] = query[key]
  if (typeof query.taskContext === 'string') {
    try {
      const context = JSON.parse(query.taskContext)
      if (context && typeof context === 'object' && !Array.isArray(context)) {
        clean.taskContext = JSON.stringify(Object.fromEntries(['q', 'view', 'state', 'closed'].filter(k => typeof context[k] === 'string' && context[k].length <= 1000).map(k => [k, context[k]])))
      }
    } catch { /* Ignore malformed saved task context. */ }
  }
  return { path, query: clean }
}

export function projectEntryLocation(id: number, origin: string, value: unknown): ProjectLocation {
  const base = `/projects/${id}`
  const candidate = value && typeof value === 'object' ? value as Partial<ProjectLocation> : null
  const saved = candidate && typeof candidate.path === 'string' && candidate.query && typeof candidate.query === 'object'
    ? savedProjectLocation(candidate.path, candidate.query) : null
  const location = saved && (saved.path === base || saved.path.startsWith(`${base}/`)) ? saved : { path: base, query: {} }
  const list = projectListReturnTo({ returnTo: origin })
  return { path: location.path, query: { ...location.query, returnTo: list, projectListReturnTo: list } }
}
