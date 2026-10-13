import { isIP } from 'node:net'
import { createError, getHeader, type H3Event } from 'h3'
import { tenantRequest, tenantUpstreamHeaders } from './tenantRequest'

/** Dedicated edge opt-in only. The operator must expose Caddy alone and let
 * it overwrite these private fields from its socket peer on every Nuxt hop. */
export function authUpstreamHeaders(event: H3Event, clientIpHeader = ''): Record<string, string> {
  if (tenantRequest(event)) return tenantUpstreamHeaders(event)
  if (!clientIpHeader) return {}
  if (clientIpHeader !== 'x-nasq-client-ip') {
    throw createError({ statusCode: 503, message: 'auth_proxy_identity_configuration_invalid' })
  }
  const clientIp = getHeader(event, clientIpHeader)
  if (!clientIp || clientIp !== clientIp.trim() || clientIp.includes('%') || !isIP(clientIp)) {
    throw createError({ statusCode: 503, message: 'auth_proxy_identity_invalid' })
  }
  const host = getHeader(event, 'x-nasq-client-host')
  const proto = getHeader(event, 'x-nasq-client-proto')
  if (!host || /[\s/\\?#@,]/.test(host) || !['http', 'https'].includes(proto ?? '')) {
    throw createError({ statusCode: 503, message: 'auth_proxy_origin_invalid' })
  }
  try {
    if (!new URL(`${proto}://${host}`).hostname) throw Error()
  } catch {
    throw createError({ statusCode: 503, message: 'auth_proxy_origin_invalid' })
  }
  // Odoo activates ProxyFix only with X-Forwarded-Host. All three fields
  // come from the overwritten edge values, never browser-supplied XFF.
  return { 'x-forwarded-for': clientIp, 'x-forwarded-host': host, 'x-forwarded-proto': proto! }
}
