import type { H3Event } from 'h3'
import { bffFail } from './errors'

const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]']

type RuntimeSettings = {
  controlUrl?: string
  serviceKey?: string
  installationId?: string
  adminOrigin?: string
  trustProxy?: boolean | string
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

/** Validated BFF settings; any missing or unsafe value answers 503 for every route. */
export function bffConfig(event: H3Event): BffConfig {
  const settings = useRuntimeConfig(event) as RuntimeSettings
  const controlBase = parseUrl(settings.controlUrl)
  const adminOrigin = parseUrl(settings.adminOrigin)
  if (!isSecureOrLoopback(controlBase) || controlBase.username || controlBase.password) unavailable()
  if (!isSecureOrLoopback(adminOrigin) || adminOrigin.origin !== settings.adminOrigin) unavailable()
  if (!settings.serviceKey || Buffer.byteLength(settings.serviceKey) < 32 || !settings.installationId) unavailable()
  return {
    controlBase,
    serviceKey: settings.serviceKey as string,
    installationId: settings.installationId as string,
    adminOrigin,
    trustProxy: settings.trustProxy === true || settings.trustProxy === 'true',
  }
}
