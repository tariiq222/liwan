import { projectIdFromPath } from '../modules/pmo/projectRoutes'
import { recordListOrigin } from './recordListOrigin'
import { parsePositiveId } from './routeParams'
import { firstQuery } from './routeQuery'

/** Query keys the old workspace carried that the section path now expresses. */
const DEAD_KEYS = ['tab', 'taskContext', 'projectListReturnTo', 'returnTo']

function keptQuery(query: Record<string, unknown>): Record<string, string> {
  const kept: Record<string, string> = {}
  for (const [key, raw] of Object.entries(query)) {
    if (DEAD_KEYS.includes(key) || key === 'view') continue
    const value = firstQuery(raw)
    if (value !== undefined) kept[key] = value
  }
  return kept
}

/** A removed section's link keeps every query key and the hash: they belong to whatever the reader was doing. */
function carried(query: Record<string, unknown>, hash: string): { query: Record<string, string>; hash?: string } {
  const kept: Record<string, string> = {}
  for (const [key, raw] of Object.entries(query)) {
    const value = firstQuery(raw)
    if (value !== undefined) kept[key] = value
  }
  return { query: kept, ...(hash ? { hash } : {}) }
}

export function legacyProjectTabTarget(
  path: string,
  query: Record<string, unknown>,
  hash = '',
): { path: string; query: Record<string, string>; hash?: string } | null {
  const bare = path.replace(/\/+$/, '') || '/'
  // Standalone /tasks used ?tab=board before DESIGN settled on ?view=board.
  if (bare === '/tasks' && firstQuery(query.tab) === 'board') {
    return { path: '/tasks', query: { ...keptQuery(query), view: 'board' } }
  }
  const id = projectIdFromPath(path)
  if (id === null) return null
  const scheduleTask = bare.match(/^\/projects\/[1-9]\d*\/schedule\/tasks\/([1-9]\d*)$/)
  const taskId = parsePositiveId(scheduleTask?.[1])
  if (taskId) {
    const source = recordListOrigin(query.returnTo, [`/projects/${id}/schedule`, `/projects/${id}/milestones`, `/projects/${id}/tasks`, '/tasks', '/my-tasks']) ?? `/projects/${id}/schedule`
    return { path: `/projects/${id}/tasks/${taskId}`, query: { returnTo: source }, hash: '#schedule' }
  }
  // The updates now live in the summary; planning is the timeline view of the tasks. `/planning` was never a page, but it names the section.
  if (bare === `/projects/${id}/updates`) return { path: `/projects/${id}`, ...carried(query, hash) }
  if (bare === `/projects/${id}/schedule` || bare === `/projects/${id}/planning`) {
    const { query: kept, hash: keptHash } = carried(query, hash)
    return { path: `/projects/${id}/tasks`, query: { ...kept, view: 'timeline' }, ...(keptHash ? { hash: keptHash } : {}) }
  }
  // Governance lost its card index to sub-tabs; old links open the first one.
  if (bare === `/projects/${id}/governance`) return { path: `/projects/${id}/charter`, query: keptQuery(query) }
  if (bare !== `/projects/${id}`) return null

  const tab = firstQuery(query.tab)
  const view = firstQuery(query.view)
  let segment: string | null = null
  let nextView: string | undefined

  if (tab === 'tasks') { segment = '/tasks'; if (view === 'board') nextView = 'board' }
  else if (tab === 'board' || tab === 'list') { segment = '/tasks'; nextView = tab }
  else if (tab === 'milestones') segment = '/milestones'
  else if (tab === 'summary' || tab === 'updates') segment = ''
  else if (!tab && view === 'board') { segment = '/tasks'; nextView = 'board' }

  if (segment === null) return null

  const nextQuery = keptQuery(query)
  if (nextView) nextQuery.view = nextView

  return { path: `/projects/${id}${segment}`, query: nextQuery }
}
