import { projectListReturnTo } from './projectNavigation'

export interface ProjectLocation { path: string; query: Record<string, string> }
const keys = ['tab', 'view', 'q', 'state', 'closed', 'kind', 'status', 'priority', 'offset', 'role', 'scale', 'type', 'category_id', 'date_from', 'date_to', 'task_q', 'stakeholder_q', 'task_page', 'stakeholder_page']
const taskKeys = ['q', 'view', 'state', 'closed']

function taskFilters(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const query = value as Record<string, unknown>
  return Object.fromEntries(taskKeys.filter(key => typeof query[key] === 'string' && query[key].length <= 1000).map(key => [key, query[key] as string]))
}

function readTaskContext(value: unknown): Record<string, string> {
  if (typeof value !== 'string') return {}
  try { return taskFilters(JSON.parse(value)) } catch { return {} }
}

/** A section changes its path, while the task list's view and filters stay available for return. */
export function projectSectionLocation(path: string, fromPath: string, query: Record<string, unknown>): ProjectLocation {
  path = path.replace(/\/+$/, '') || '/'
  fromPath = fromPath.replace(/\/+$/, '') || '/'
  const origin: Record<string, string> = {}
  for (const key of ['returnTo', 'projectListReturnTo']) if (typeof query[key] === 'string' && query[key].length <= 1000) origin[key] = query[key]
  const tasksPath = path.match(/^\/projects\/[1-9]\d*/)?.[0] + '/tasks'
  const tasks = fromPath === tasksPath ? taskFilters(query) : readTaskContext(query.taskContext)
  if (path === tasksPath) return { path, query: { ...tasks, ...origin } }
  const sameSection = path === fromPath ? savedProjectLocation(path, query)?.query ?? {} : {}
  return { path, query: { ...sameSection, ...origin, ...(Object.keys(tasks).length ? { taskContext: JSON.stringify(tasks) } : {}) } }
}

/** Only browseable sections are eligible; never reopen a form or record. */
export function savedProjectLocation(path: string, query: Record<string, unknown>): ProjectLocation | null {
  path = path.replace(/\/+$/, '') || '/'
  if (!/^\/projects\/[1-9]\d*(?:\/(tasks|milestones|register|stakeholders|raci|finance|charter|schedule|updates))?$/.test(path) || query.edit != null) return null
  const clean: Record<string, string> = {}
  for (const key of keys) if (typeof query[key] === 'string' && query[key].length <= 1000) clean[key] = query[key]
  if (typeof query.taskContext === 'string') {
    const context = readTaskContext(query.taskContext)
    if (Object.keys(context).length) clean.taskContext = JSON.stringify(context)
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
