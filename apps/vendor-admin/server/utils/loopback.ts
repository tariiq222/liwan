import { isIP } from 'node:net'
import { getHeader, getRequestIP, type H3Event } from 'h3'


export const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]']
/** Socket peer addresses of the same machine, as Node reports them. */
export const LOOPBACK_PEERS = ['127.0.0.1', '::1', '::ffff:127.0.0.1']

/** An origin string that is plain http on this machine. */
export function isLoopbackHttp(origin: string | undefined): boolean {
  try {
    const url = new URL(origin ?? '')
    return url.protocol === 'http:' && LOOPBACK_HOSTS.includes(url.hostname)
  } catch {
    return false
  }
}

/**
 * The developer sign-in needs the public devLogin setting and a loopback http admin origin. NODE_ENV is not read: the local
 * production build runs with NODE_ENV=production. The control plane is the binding gate (ADMIN_DEV_LOGIN_EMAIL).
 */
export function devLoginAllowed(input: { devLogin: unknown, adminOrigin: string | undefined }): boolean {
  return input.devLogin === true && isLoopbackHttp(input.adminOrigin)
}

/** Set by the `nuxt dev` proxy on every request it relays. */
const DEV_PROXY_HEADER = 'x-nuxt-dev-request-id'

/**
 * The socket peer. `nuxt dev` relays requests through a proxy that hides it, so on a loopback http admin
 * origin only, the address the proxy appended to x-forwarded-for (its last entry) stands in for it.
 */
export function peerAddress(event: H3Event, adminOrigin: string | undefined): string | undefined {
  const socket = getRequestIP(event, { xForwardedFor: false })
  if (socket) return socket
  if (!isLoopbackHttp(adminOrigin) || !getHeader(event, DEV_PROXY_HEADER)) return undefined
  const appended = getHeader(event, 'x-forwarded-for')?.split(',').at(-1)?.trim()
  return appended && isIP(appended) ? appended : undefined
}
