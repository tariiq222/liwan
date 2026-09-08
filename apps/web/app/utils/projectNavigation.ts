import { safeReturnTo } from './safeReturnTo'

/** Recover the list origin even after opening a nested project form. */
export function projectListReturnTo(query: Record<string, unknown>): string {
  let candidate = query.projectListReturnTo ?? query.returnTo
  for (let depth = 0; depth < 6; depth++) {
    const safe = safeReturnTo(candidate, '', ['/projects'])
    if (!safe) return '/projects'
    const url = new URL(safe, 'http://nasq.local')
    if (url.pathname === '/projects' || url.pathname === '/projects/dashboard') return safe
    candidate = url.searchParams.get('projectListReturnTo') ?? url.searchParams.get('returnTo')
  }
  return '/projects'
}
