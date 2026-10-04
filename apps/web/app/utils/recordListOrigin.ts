import type { LocationQuery, LocationQueryRaw, RouteLocationRaw } from 'vue-router'
import { safeReturnTo } from './safeReturnTo'

export const MEETING_LIST_PATHS = ['/meetings', '/meetings/calendar'] as const
export const SERIES_LIST_PATHS = ['/meetings/series'] as const
export const EMPLOYEE_LIST_PATHS = ['/hr'] as const

function listOrigin(value: unknown, paths: readonly string[]): string | undefined {
  const safe = safeReturnTo(value, '', paths)
  if (!safe) return undefined
  const url = new URL(safe, 'http://nasq.local')
  if (!paths.includes(url.pathname)) return undefined
  // Context never recursively contains another navigation context.
  for (const key of ['returnTo', 'listOrigin']) {
    if (url.searchParams.has(key)) url.searchParams.delete(key)
  }
  return `${url.pathname}${url.search}${url.hash}`
}
function directQuery(query: LocationQuery): LocationQueryRaw {
  const { returnTo: _referrer, listOrigin: _origin, ...direct } = query
  return direct
}

export function owningListBack(query: LocationQuery, paths: readonly string[], hash = ''): RouteLocationRaw {
  return listOrigin(query.returnTo, paths) ?? { path: paths[0]!, query: directQuery(query), ...(hash ? { hash } : {}) }
}

// Only the record translates a valid list referrer into child context. A
// directly opened editor's returnTo never skips its owning record.
export function recordChildTo(path: string, query: LocationQuery, paths: readonly string[], hash = ''): RouteLocationRaw {
  const origin = listOrigin(query.returnTo, paths)
  return { path, query: { ...directQuery(query), ...(origin ? { listOrigin: origin } : {}) }, ...(hash ? { hash } : {}) }
}
export function recordParentTo(path: string, query: LocationQuery, paths: readonly string[], hash = ''): RouteLocationRaw {
  const origin = listOrigin(query.listOrigin, paths)
  return { path, query: { ...directQuery(query), ...(origin ? { returnTo: origin } : {}) }, ...(hash ? { hash } : {}) }
}

// Moving between editors of the same record retains only normalized child
// context, without converting it into a new level of returnTo.
export function recordSiblingTo(path: string, query: LocationQuery, paths: readonly string[], hash = ''): RouteLocationRaw {
  const origin = listOrigin(query.listOrigin, paths)
  const nextQuery = { ...directQuery(query), ...(origin ? { listOrigin: origin } : {}) }
  return Object.keys(nextQuery).length || hash ? { path, query: nextQuery, ...(hash ? { hash } : {}) } : path
}
