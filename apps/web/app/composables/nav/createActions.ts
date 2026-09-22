import type { RouteLocationRaw } from 'vue-router'
// Relative imports: the `@/` alias does not resolve for value imports under a
// plain `vitest run`, and this module is unit-tested directly.
import { parseChatListRoute, serializeChatListRoute } from '../../utils/chatState'
import { meetingCreateRoute } from '../../utils/meetingRoutes'
import { returnToQuery, safeReturnTo } from '../../utils/safeReturnTo'

/** The route fields a create action reads; the shell passes `useRoute()`. */
export interface CreateActionRoute {
  path: string
  fullPath: string
  query: Record<string, unknown>
  params: Record<string, unknown>
}

/**
 * Where a create form returns to. Standing on the list the action belongs to,
 * the current filters are the return target; anywhere else it is that module's
 * list, taking a `returnTo` only when it stays inside the module.
 */
export function createListReturnTo(linkId: string, routePath: string, fullPath: string, query: Record<string, unknown>): string {
  const path = routePath.replace(/\/+$/, '') || '/'
  if (linkId === 'new-tenant') {
    return path === '/vendor/tenants' ? fullPath : safeReturnTo(query.returnTo, '/vendor/tenants', ['/vendor/tenants'])
  }
  if (linkId === 'new-project') {
    return path === '/projects' || path === '/projects/dashboard'
      ? fullPath
      : safeReturnTo(query.returnTo, '/projects', ['/projects'])
  }
  if (linkId === 'new-meeting') {
    return path === '/meetings' || path === '/meetings/calendar' || path === '/meetings/series'
      ? fullPath
      : safeReturnTo(query.returnTo, '/meetings', ['/meetings'])
  }
  if (linkId === 'new-employee' || linkId === 'new-department' || linkId === 'new-document') {
    const isHrList = linkId === 'new-employee'
      ? path === '/hr'
      : linkId === 'new-department'
        ? path === '/hr/departments'
        : path === '/hr/documents' || /^\/hr\/departments\/[^/]+\/documents$/.test(path)
    if (isHrList) return fullPath
    const fallback = linkId === 'new-department' ? '/hr/departments' : linkId === 'new-document' ? '/hr/documents' : '/hr'
    return safeReturnTo(query.returnTo, fallback, ['/hr'])
  }
  return fullPath
}

/**
 * The target of a pinned create action. One owner for the desktop sidebar and
 * the mobile menu, so a change to either reaches both.
 */
export function createLinkTo(link: { id: string; to: RouteLocationRaw }, route: CreateActionRoute): RouteLocationRaw {
  if (link.id === 'new-chat') return { path: '/chat/new', query: serializeChatListRoute(parseChatListRoute(route.query)) }
  if (link.id === 'new-meeting') return meetingCreateRoute(createListReturnTo(link.id, route.path, route.fullPath, route.query), typeof route.query.project_id === 'string' ? route.query.project_id : undefined, typeof route.query.series_id === 'string' ? route.query.series_id : undefined)
  const target = typeof link.to === 'string' ? link.to : link.to.path
  if (!target) return link.to
  const query: Record<string, string> = returnToQuery(createListReturnTo(link.id, route.path, route.fullPath, route.query))
  if (link.id === 'new-document') {
    const departmentId = typeof route.query.department_id === 'string'
      ? route.query.department_id
      : typeof route.params.departmentId === 'string' ? route.params.departmentId : undefined
    if (departmentId) query.department_id = departmentId
  }
  return { path: target, query }
}
