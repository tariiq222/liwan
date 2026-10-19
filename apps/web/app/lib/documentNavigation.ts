import type { LocationQuery, RouteLocationRaw } from 'vue-router'
import { recordEntryOrigin, recordListOrigin } from '../utils/recordListOrigin'
import { safeReturnTo } from '@webvue/ui/app/utils/safeReturnTo'

function origin(value: unknown): string | undefined {
  const list = recordListOrigin(value, ['/documents', '/hr/departments'])
  if (list) return list
  const safe = safeReturnTo(value, '', ['/hr/departments'])
  if (!safe) return undefined
  const path = new URL(safe, 'http://webvue.local').pathname
  if (!/^\/hr\/departments\/[1-9]\d*$/.test(path)) return undefined
  return recordEntryOrigin(safe, path, ['/hr/departments'])
}
function direct(query: LocationQuery) {
  const { returnTo: _return, listOrigin: _origin, ...rest } = query
  return rest
}
/** The library owns new entries; migrated department entries may return to their exact safe origin. */
export function documentRecordBack(query: LocationQuery, hash = ''): RouteLocationRaw {
  return origin(query.returnTo) ?? { path: '/documents', query: direct(query), hash }
}
export function documentChildTo(path: string, query: LocationQuery, hash = ''): RouteLocationRaw {
  const source = origin(query.returnTo)
  return { path, query: { ...direct(query), ...(source ? { listOrigin: source } : {}) }, hash }
}
export function documentParentTo(path: string, query: LocationQuery, hash = ''): RouteLocationRaw {
  const source = origin(query.listOrigin)
  return { path, query: { ...direct(query), ...(source ? { returnTo: source } : {}) }, hash }
}
