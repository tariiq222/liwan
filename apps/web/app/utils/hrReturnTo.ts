import type { LocationQuery, LocationQueryRaw, RouteLocationRaw } from 'vue-router'
import { recordListOrigin } from './recordListOrigin'

const DEPARTMENTS = '/hr/departments'

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
