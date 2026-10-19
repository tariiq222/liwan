import type { RouteLocationNormalized, RouteLocationRaw, LocationQueryRaw } from 'vue-router'
import { stringifyQuery } from 'vue-router'
import { safeReturnTo } from '@webvue/ui/app/utils/safeReturnTo'

const positiveId = (value: string) => /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value))
function mapQuery(query: RouteLocationNormalized['query'], department?: string): LocationQueryRaw {
  const { department_id, returnTo, ...next } = query
  const context = department ?? (typeof department_id === 'string' && positiveId(department_id) ? department_id : undefined)
  const mapped: LocationQueryRaw = { ...next }
  if (context) { mapped.context_kind = 'hr.department'; mapped.context_id = context }
  const safe = safeReturnTo(returnTo, '', ['/documents', '/hr/documents', '/hr/departments'])
  if (safe) {
    const url = new URL(safe, 'http://webvue.local')
    url.searchParams.delete('returnTo'); url.searchParams.delete('listOrigin')
    if (url.pathname === '/hr/documents') {
      const params = Object.fromEntries(url.searchParams)
      const converted = mapQuery(params)
      const search = stringifyQuery(converted)
      mapped.returnTo = `/documents${search ? `?${search}` : ''}${url.hash}`
    } else mapped.returnTo = `${url.pathname}${url.search}${url.hash}`
  }
  return mapped
}
/** Navigation only. Document ids survive the DMS migration; no legacy API call. */
export function documentEntryRedirect(to: Pick<RouteLocationNormalized, 'path' | 'query' | 'hash'>): RouteLocationRaw | null {
  const path = to.path.replace(/\/+$/, '')
  if (path === '/hr/documents' || path === '/hr/documents/new') return { path: path.replace('/hr/documents', '/documents'), query: mapQuery(to.query), hash: to.hash }
  const match = path.match(/^\/hr\/departments\/([^/]+)\/documents(?:\/([^/]+))?(\/edit)?$/)
  if (!match || !positiveId(match[1]!)) return null
  const [, department, document, edit] = match
  if (!document) return { path: '/documents', query: mapQuery(to.query, department), hash: to.hash }
  if (document === 'new' && !edit) return { path: '/documents/new', query: mapQuery(to.query, department), hash: to.hash }
  if (!positiveId(document)) return null
  return { path: `/documents/${document}${edit ?? ''}`, query: mapQuery(to.query), hash: to.hash }
}
