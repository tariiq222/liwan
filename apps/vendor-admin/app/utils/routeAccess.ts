import { normalizePath, safeReturnTo } from './safeReturnTo'

export type RouteAccess =
  | { action: 'allow' }
  | { action: 'login', next?: string }
  | { action: 'redirect', to: string }
  | { action: 'forbidden' }

interface AccessInput {
  isPublic: boolean
  me: { capabilities: string[] } | null
  fullPath: string
  path?: string
  /** The `next` query value of the login page. */
  next?: unknown
  capability?: string
}

/** What a navigation may do: public pages are open, the rest need a session and the page's capability. */
export function decideAccess({ isPublic, me, fullPath, path, next, capability }: AccessInput): RouteAccess {
  if (isPublic) return me && path !== undefined && normalizePath(path) === '/login' ? { action: 'redirect', to: safeReturnTo(next) ?? '/' } : { action: 'allow' }
  if (!me) {
    const target = safeReturnTo(fullPath)
    return target && target !== '/' ? { action: 'login', next: target } : { action: 'login' }
  }
  return capability && !me.capabilities.includes(capability) ? { action: 'forbidden' } : { action: 'allow' }
}
