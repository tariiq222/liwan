import { owningListBack, recordEntryOrigin } from './recordListOrigin'
import type { LocationQuery } from 'vue-router'
import { safeReturnTo } from '@liwan/ui/app/utils/safeReturnTo'

/** Recover the list origin even after opening a nested project form. */
export function projectListReturnTo(query: Record<string, unknown>): string {
  let candidate = query.projectListReturnTo ?? query.returnTo
  for (let depth = 0; depth < 6; depth++) {
    const safe = safeReturnTo(candidate, '', ['/projects'])
    if (!safe) return '/projects'
    const url = new URL(safe, 'http://liwan.local')
    if (url.pathname === '/projects' || url.pathname === '/projects/dashboard') return safe
    candidate = url.searchParams.get('projectListReturnTo') ?? url.searchParams.get('returnTo')
  }
  return '/projects'
}

/** A copied project can return to its readable source project, with one normalized list behind it. */
export function projectRecordBack(query: LocationQuery, currentId: number | null, paths: readonly string[], hash = '') {
  const origins = paths.filter(path => path !== `/projects/${currentId}`)
  const safe = safeReturnTo(query.returnTo, '', ['/projects'])
  const parent = safe && new URL(safe, 'http://liwan.local').pathname
  const match = parent && /^\/projects\/([1-9]\d*)$/.exec(parent)
  if (match && Number(match[1]) !== currentId && origins.includes('/projects')) {
    const origin = recordEntryOrigin(safe, parent as string, origins)
    if (origin) return origin
  }
  return owningListBack(query, origins, hash)
}
