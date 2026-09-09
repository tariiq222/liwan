import { safeReturnTo } from './safeReturnTo'

/** The only cross-component contract for the project modal branch. */
export const PROJECT_OVERLAY_INJECTION_KEY = Symbol.for('nasq.project.overlay')

type RouteQuery = Record<string, unknown>

const PROJECT_ID = '[1-9]\\d*'
const PROJECT_WORKFLOW_PATTERNS = [
  new RegExp(`^/projects/${PROJECT_ID}/tasks/(?:new|${PROJECT_ID})$`),
  new RegExp(`^/projects/${PROJECT_ID}/milestones/(?:new|${PROJECT_ID}/edit)$`),
  new RegExp(`^/projects/${PROJECT_ID}/stakeholders/(?:new|${PROJECT_ID}(?:/edit)?)$`),
  new RegExp(`^/projects/${PROJECT_ID}/register/(?:new|${PROJECT_ID}(?:/edit)?)$`),
  new RegExp(`^/projects/${PROJECT_ID}/finance/(?:new|${PROJECT_ID}(?:/edit)?)$`),
  new RegExp(`^/projects/${PROJECT_ID}/updates/new$`),
  new RegExp(`^/projects/${PROJECT_ID}/schedule/tasks/${PROJECT_ID}$`),
  /^\/project-templates\/(?:new|[1-9]\d*(?:\/(?:edit|apply))?)$/,
]

function normalizedPath(path: string): string {
  return path.replace(/\/+$/, '') || '/'
}

function queryValue(query: RouteQuery, key: string): unknown {
  return query[key]
}

function isOne(value: unknown): boolean {
  return value === '1' || (Array.isArray(value) && value.length === 1 && value[0] === '1')
}

export function wantsProjectOverlayFullPage(query: RouteQuery): boolean {
  return isOne(queryValue(query, 'fullPage'))
}

export function isProjectOverlayRoute(route: { path: string; query: RouteQuery }): boolean {
  const path = normalizedPath(route.path)
  if (path === '/projects/new') return true
  if (new RegExp(`^/projects/${PROJECT_ID}/charter$`).test(path)) return isOne(queryValue(route.query, 'edit'))
  return PROJECT_WORKFLOW_PATTERNS.some(pattern => pattern.test(path))
}

function queryFromSearch(search: string): RouteQuery {
  const parsed = new URL(search, 'http://nasq.local')
  const query: RouteQuery = {}
  for (const [key, value] of parsed.searchParams.entries()) query[key] = value
  return query
}

function validProjectReturnTo(value: unknown, currentPath: string): string | null {
  const candidate = safeReturnTo(value, '', ['/projects', '/project-templates'])
  if (!candidate) return null
  try {
    const parsed = new URL(candidate, 'http://nasq.local')
    if (isProjectOverlayRoute({ path: parsed.pathname, query: queryFromSearch(candidate) })) return null
    if (!isProjectBackgroundPath(parsed.pathname)) return null
    const currentProjectId = projectIdFrom(currentPath)
    const returnProjectId = projectIdFrom(parsed.pathname)
    if (currentProjectId && returnProjectId && currentProjectId !== returnProjectId) return null
  } catch {
    return null
  }
  return candidate
}

function projectIdFrom(path: string): string | null {
  const match = normalizedPath(path).match(new RegExp(`^/projects/(${PROJECT_ID})(?:/|$)`))
  return match?.[1] ?? null
}

function isProjectBackgroundPath(path: string): boolean {
  const normalized = normalizedPath(path)
  if (normalized === '/projects' || normalized === '/projects/dashboard' || normalized === '/project-templates') return true
  const id = projectIdFrom(normalized)
  if (!id) return false
  return new RegExp(`^/projects/${id}(?:/charter|/finance|/register|/stakeholders|/raci|/updates|/schedule)?$`).test(normalized)
}

function fallbackBase(path: string): { path: string; query?: Record<string, string> } {
  const normalized = normalizedPath(path)
  if (normalized === '/projects/new') return { path: '/projects' }
  if (normalized.startsWith('/project-templates/')) return { path: '/project-templates' }

  const id = projectIdFrom(normalized)
  if (!id) return { path: '/projects' }
  if (normalized.includes(`/projects/${id}/tasks/`)) return { path: `/projects/${id}`, query: { tab: 'tasks' } }
  if (normalized.includes(`/projects/${id}/milestones/`)) return { path: `/projects/${id}`, query: { tab: 'milestones' } }
  if (normalized.includes(`/projects/${id}/stakeholders/`)) return { path: `/projects/${id}/stakeholders` }
  if (normalized.includes(`/projects/${id}/register/`)) return { path: `/projects/${id}/register` }
  if (normalized.includes(`/projects/${id}/finance/`)) return { path: `/projects/${id}/finance` }
  if (normalized.includes(`/projects/${id}/updates/`)) return { path: `/projects/${id}/updates` }
  if (normalized.includes(`/projects/${id}/schedule/`)) return { path: `/projects/${id}/schedule` }
  return { path: `/projects/${id}` }
}

function appendQuery(base: string, query: RouteQuery, omit: readonly string[]): string {
  const params = new URLSearchParams()
  for (const [key, raw] of Object.entries(query)) {
    if (omit.includes(key)) continue
    if (Array.isArray(raw)) {
      for (const value of raw) if (typeof value === 'string') params.append(key, value)
    } else if (typeof raw === 'string') {
      params.set(key, raw)
    }
  }
  const search = params.toString()
  return search ? `${base}?${search}` : base
}

function fallbackQueryKeys(path: string): readonly string[] {
  const normalized = normalizedPath(path)
  if (normalized.includes('/finance/')) return ['q', 'kind', 'offset']
  if (normalized.includes('/register/')) return ['q', 'kind', 'status', 'priority', 'offset']
  if (normalized.includes('/stakeholders/')) return ['q', 'offset']
  if (normalized.includes('/schedule/')) return ['scale']
  if (normalized.includes('/project-templates/')) return ['q', 'offset']
  return ['tab', 'view']
}

export function deriveProjectOverlayBackground(path: string, query: RouteQuery): string {
  const explicit = validProjectReturnTo(queryValue(query, 'returnTo'), path)
  if (explicit) return explicit

  const fallback = fallbackBase(path)
  if (fallback.query) return appendQuery(fallback.path, fallback.query, [])
  const allowed = fallbackQueryKeys(path)
  const filtered = Object.fromEntries(Object.entries(query).filter(([key]) => allowed.includes(key)))
  return appendQuery(fallback.path, filtered, [])
}
