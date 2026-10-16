import { getRequestIP, type H3Event } from 'h3'
import { bffFail } from './errors'
import { devLoginAllowed, LOOPBACK_HOSTS, LOOPBACK_PEERS } from './loopback'

type RuntimeSettings = {
  controlUrl?: string
  serviceKey?: string
  installationId?: string
  adminOrigin?: string
  trustProxy?: boolean | string
  public?: { devLogin?: boolean }
}

export type BffConfig = {
  controlBase: URL
  serviceKey: string
  installationId: string
  adminOrigin: URL
  trustProxy: boolean
}

const unavailable = (): never => bffFail(503, 'vendor_unavailable')

function parseUrl(value: string | undefined): URL {
  try { return new URL(value ?? '') } catch { return unavailable() }
}

/** https, or http on loopback (local development only). */
const isSecureOrLoopback = (url: URL): boolean =>
  url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK_HOSTS.includes(url.hostname))

/**
 * Whether the developer sign-in routes exist: the public setting is on, the admin origin is loopback http and the caller is on
 * this machine. The peer is the socket address only, never x-forwarded-for, so a forged Origin or proxy header from the network opens nothing.
 */
export function devLoginEnabled(event: H3Event): boolean {
  const settings = useRuntimeConfig(event) as RuntimeSettings
  const peer = getRequestIP(event, { xForwardedFor: false }) ?? ''
  return LOOPBACK_PEERS.includes(peer) && devLoginAllowed({ devLogin: settings.public?.devLogin, adminOrigin: settings.adminOrigin })
}

/** Validated BFF settings; any missing or unsafe value answers 503 for every route. */
export function bffConfig(event: H3Event): BffConfig {
  const settings = useRuntimeConfig(event) as RuntimeSettings
  const controlBase = parseUrl(settings.controlUrl)
  const adminOrigin = parseUrl(settings.adminOrigin)
  if (!isSecureOrLoopback(controlBase) || controlBase.username || controlBase.password) unavailable()
  if (!isSecureOrLoopback(adminOrigin) || adminOrigin.origin !== settings.adminOrigin) unavailable()
  if (!settings.serviceKey || Buffer.byteLength(settings.serviceKey) < 32 || !settings.installationId) unavailable()
  const trustProxy = settings.trustProxy === true || settings.trustProxy === 'true'
  // Behind the https edge every request reaches Nuxt from the proxy: without x-forwarded-for all clients would share one address.
  if (adminOrigin.protocol === 'https:' && !trustProxy) unavailable()
  return {
    controlBase,
    serviceKey: settings.serviceKey as string,
    installationId: settings.installationId as string,
    adminOrigin,
    trustProxy,
  }
}
