import type { LocationQuery, LocationQueryRaw, RouteLocationRaw } from 'vue-router'
import { safeReturnTo } from './safeReturnTo'

const DEPARTMENTS = '/hr/departments'
const DOCUMENTS = '/hr/documents'

function exactOrigin(value: unknown, path: string): URL | null {
  const safe = safeReturnTo(value, '', [path])
  if (!safe) return null
  const parsed = new URL(safe, 'http://nasq.local')
  return parsed.pathname === path ? parsed : null
}
function relative(url: URL): string { return `${url.pathname}${url.search}${url.hash}` }
function listOrigin(value: unknown, path: string): string | undefined {
  const parsed = exactOrigin(value, path)
  if (!parsed) return undefined
  if (parsed.searchParams.has('returnTo')) parsed.searchParams.delete('returnTo')
  return relative(parsed)
}
function context(query: LocationQuery, origin: string | undefined): LocationQueryRaw {
  const { returnTo: _referrer, ...directQuery } = query
  return origin ? { ...directQuery, returnTo: origin } : directQuery
}

// Consume the one list origin on arrival; never forward it onto the list itself.
export function hrDepartmentBack(query: LocationQuery, hash = ''): RouteLocationRaw {
  return listOrigin(query.returnTo, DEPARTMENTS) ?? { path: DEPARTMENTS, query: context(query, undefined), ...(hash ? { hash } : {}) }
}
export function hrDepartmentContext(query: LocationQuery): LocationQueryRaw {
  return context(query, listOrigin(query.returnTo, DEPARTMENTS))
}

function documentOrigin(value: unknown, departmentId: number): string | undefined {
  const department = exactOrigin(value, `${DEPARTMENTS}/${departmentId}`)
  if (!department) return listOrigin(value, DOCUMENTS)
  // At most one immediate department plus one departments-list origin. A
  // duplicate, invalid or recursively wrapped origin is consumed here.
  const origins = department.searchParams.getAll('returnTo')
  const origin = origins.length === 1 ? listOrigin(origins[0], DEPARTMENTS) : undefined
  if (origins.length && origin !== origins[0]) {
    department.searchParams.delete('returnTo')
    if (origin) department.searchParams.set('returnTo', origin)
  }
  return relative(department)
}
export function hrDocumentBack(query: LocationQuery, departmentId: number, hash = ''): RouteLocationRaw {
  return documentOrigin(query.returnTo, departmentId) ?? { path: DOCUMENTS, query: context(query, undefined), ...(hash ? { hash } : {}) }
}
export function hrDocumentContext(query: LocationQuery, departmentId: number): LocationQueryRaw {
  return context(query, documentOrigin(query.returnTo, departmentId))
}
