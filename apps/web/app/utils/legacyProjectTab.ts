import { projectIdFromPath } from '../composables/nav/activeRoute'

/** Query keys the old workspace carried that the section path now expresses. */
const DEAD_KEYS = ['tab', 'taskContext', 'projectListReturnTo', 'returnTo']

function firstString(value: unknown): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value
  return typeof raw === 'string' ? raw : undefined
}

function keptQuery(query: Record<string, unknown>): Record<string, string> {
  const kept: Record<string, string> = {}
  for (const [key, raw] of Object.entries(query)) {
    if (DEAD_KEYS.includes(key) || key === 'view') continue
    const value = firstString(raw)
    if (value !== undefined) kept[key] = value
  }
  return kept
}

export function legacyProjectTabTarget(
  path: string,
  query: Record<string, unknown>,
): { path: string; query: Record<string, string> } | null {
  const id = projectIdFromPath(path)
  if (id === null) return null
  const bare = path.replace(/\/+$/, '') || '/'
  // Governance lost its card index to sub-tabs; old links open the first one.
  if (bare === `/projects/${id}/governance`) return { path: `/projects/${id}/charter`, query: keptQuery(query) }
  if (bare !== `/projects/${id}`) return null

  const tab = firstString(query.tab)
  const view = firstString(query.view)
  let segment: string | null = null
  let nextView: string | undefined

  if (tab === 'tasks') segment = '/tasks'
  else if (tab === 'board' || tab === 'list') { segment = '/tasks'; nextView = tab }
  else if (tab === 'milestones') segment = '/milestones'
  else if (tab === 'summary') segment = ''
  else if (!tab && view === 'board') { segment = '/tasks'; nextView = 'board' }

  if (segment === null) return null

  const nextQuery = keptQuery(query)
  if (nextView) nextQuery.view = nextView

  return { path: `/projects/${id}${segment}`, query: nextQuery }
}
