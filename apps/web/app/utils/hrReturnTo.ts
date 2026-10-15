import type { LocationQuery, LocationQueryRaw, RouteLocationRaw } from 'vue-router'
import { recordListOrigin, recordEntryOrigin } from './recordListOrigin'

const DEPARTMENTS = '/hr/departments'
const DOCUMENTS = '/hr/documents'

function context(query: LocationQuery, origin: string | undefined): LocationQueryRaw {
  const { returnTo: _referrer, ...directQuery } = query
  return origin ? { ...directQuery, returnTo: origin } : directQuery
}

// Consume the one list origin on arrival; never forward it onto the list itself.
export function hrDepartmentBack(query: LocationQuery, hash = '', paths: readonly string[] = [DEPARTMENTS]): RouteLocationRaw {
  return recordListOrigin(query.returnTo, paths) ?? { path: DEPARTMENTS, query: context(query, undefined), ...(hash ? { hash } : {}) }
}
export function hrDepartmentContext(query: LocationQuery, paths: readonly string[] = [DEPARTMENTS]): LocationQueryRaw {
  return context(query, recordListOrigin(query.returnTo, paths))
}

function documentOrigin(value: unknown, departmentId: number, paths: readonly string[]): string | undefined {
  return recordEntryOrigin(value, `${DEPARTMENTS}/${departmentId}`, [DEPARTMENTS, ...paths]) ?? recordListOrigin(value, paths)
}
export function hrDocumentBack(query: LocationQuery, departmentId: number, hash = '', paths: readonly string[] = [DOCUMENTS]): RouteLocationRaw {
  return documentOrigin(query.returnTo, departmentId, paths) ?? { path: DOCUMENTS, query: context(query, undefined), ...(hash ? { hash } : {}) }
}
export function hrDocumentContext(query: LocationQuery, departmentId: number, paths: readonly string[] = [DOCUMENTS]): LocationQueryRaw {
  return context(query, documentOrigin(query.returnTo, departmentId, paths))
}
