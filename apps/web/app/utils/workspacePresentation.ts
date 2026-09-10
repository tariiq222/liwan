import { isProjectOverlayRoute, deriveProjectOverlayBackground } from './projectOverlayRoute'
import { safeReturnTo } from './safeReturnTo'

type RouteQuery = Record<string, unknown>
const workflows = [
  /^\/tasks\/(?:new|[1-9]\d*)$/,
  /^\/meetings\/(?:new|[1-9]\d*(?:\/(?:edit|minutes|resolutions\/(?:new|[1-9]\d*\/edit)))?)$/,
  /^\/meetings\/series\/(?:new|[1-9]\d*(?:\/edit)?)$/,
  /^\/hr\/employees\/(?:new|[1-9]\d*(?:\/(?:edit|access))?)$/,
  /^\/hr\/departments\/(?:new|[1-9]\d*(?:\/edit|\/documents\/(?:new|[1-9]\d*(?:\/edit)?))?)$/,
  /^\/hr\/documents\/new$/,
  /^\/settings\/users\/(?:new|[1-9]\d*(?:\/(?:access|security))?)$/,
  /^\/settings\/roles\/(?:new|[1-9]\d*(?:\/edit)?)$/,
  /^\/settings\/access-log\/[1-9]\d*$/,
  /^\/notification-digests\/[1-9]\d*$/,
]
const roots = ['/tasks', '/archived-tasks', '/meetings', '/meetings/calendar', '/meetings/series', '/hr', '/hr/departments', '/hr/documents', '/settings/users', '/settings/roles', '/settings/access-log', '/notifications']
const normalize = (path: string) => path.replace(/\/+$/, '') || '/'

/** Portaled menus and toasts follow the active module; chat keeps its design. */
export function isWorkspaceThemeRoute(path: string): boolean {
  return !/^\/(?:chat|login)(\/|$)/.test(path) && !/^\/meetings\/[1-9]\d*\/print\/?$/.test(path)
}
export function isWorkspaceOverlayRoute(route: { path: string; query: RouteQuery }): boolean {
  return isProjectOverlayRoute(route) || workflows.some(pattern => pattern.test(normalize(route.path)))
}
function section(path: string): string {
  if (/^\/tasks\//.test(path)) return '/tasks'
  if (/^\/meetings\/series\//.test(path)) return '/meetings/series'
  if (/^\/meetings\//.test(path)) return '/meetings'
  if (/^\/hr\/(?:documents\/|departments\/[^/]+\/documents\/)/.test(path)) return '/hr/documents'
  if (/^\/hr\/departments\//.test(path)) return '/hr/departments'
  if (/^\/hr\//.test(path)) return '/hr'
  if (/^\/settings\/users\//.test(path)) return '/settings/users'
  if (/^\/settings\/roles\//.test(path)) return '/settings/roles'
  if (/^\/settings\/access-log\//.test(path)) return '/settings/access-log'
  return '/notifications'
}
function family(path: string): string {
  if (path === '/archived-tasks' || path.startsWith('/tasks')) return 'tasks'
  if (path.startsWith('/notification')) return 'notifications'
  if (path.startsWith('/settings/')) return path.split('/').slice(0, 3).join('/')
  return path.split('/')[1] || ''
}
/** Only a section in the current module may be retained beneath a sheet. */
export function isWorkspaceOverlayBackground(path: string, candidate: string): boolean {
  const parsed = new URL(candidate, 'http://nasq.local')
  return roots.includes(normalize(parsed.pathname)) && family(path) === family(parsed.pathname)
}
export function deriveWorkspaceOverlayBackground(path: string, query: RouteQuery, depth = 0): string {
  if (isProjectOverlayRoute({ path, query })) return deriveProjectOverlayBackground(path, query)
  const candidate = safeReturnTo(query.returnTo, '', roots)
  if (candidate && isWorkspaceOverlayBackground(path, candidate)) return candidate
  if (candidate && depth < 8) {
    const parsed = new URL(candidate, 'http://nasq.local')
    const nestedQuery = Object.fromEntries(parsed.searchParams)
    if (family(path) === family(parsed.pathname) && isWorkspaceOverlayRoute({ path: parsed.pathname, query: nestedQuery })) {
      return deriveWorkspaceOverlayBackground(parsed.pathname, nestedQuery, depth + 1)
    }
  }
  const base = section(normalize(path))
  const allowed = ['q', 'status', 'offset', 'tab', 'view', 'department_id', 'role_id', 'active', 'kind', 'type', 'state', 'date_from', 'date_to', 'mine', 'series_id', 'organizer_id', 'project_id', 'actor_user_id', 'target_type', 'target_id', 'action']
  const params = new URLSearchParams()
  for (const key of allowed) {
    const raw = query[key]
    if (typeof raw === 'string') params.set(key, raw)
    else if (Array.isArray(raw)) for (const value of raw) if (typeof value === 'string') params.append(key, value)
  }
  return params.size ? base + '?' + params.toString() : base
}
export function workspaceOverlayTitleKey(path: string): string {
  if (path.startsWith('/hr')) return 'nav.humanResources'
  if (path.startsWith('/meetings')) return 'nav.meetings'
  if (path.startsWith('/tasks')) return 'nav.tasks'
  if (path.startsWith('/settings')) return 'nav.settings'
  if (path.startsWith('/notification')) return 'notifications.title'
  return 'projects.title'
}
