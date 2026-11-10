import { tenantTransport, withUpstreamSlot } from '../../utils/tenantTransport'
import { authCookiesAreSecure, forwardAuthCookies } from '../../utils/authCookies'
import { authUpstreamHeaders } from '../../utils/authUpstreamHeaders'
import { tenantRequest } from '../../utils/tenantRequest'

export default defineEventHandler(async (event) => {
  assertSameSiteJson(event)
  const { odooUrl, authProxyClientIpHeader } = useRuntimeConfig(event)
  const cookie = getHeader(event, 'cookie') ?? ''
  const bound = Boolean(tenantRequest(event) || process.env.LIWAN_RELEASE_ROUTES_DIR)
  const send = bound ? (options: { method: string; headers: Record<string, string>; body: string }) => tenantTransport(event, odooUrl, '/web/session/destroy', options) : (options: RequestInit) => withUpstreamSlot(signal => fetch(`${odooUrl}/web/session/destroy`, { ...options, signal }), event)
  const identityHeaders = authUpstreamHeaders(event, authProxyClientIpHeader)
  const upstream = await send({
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie, ...identityHeaders },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: {} }),
  })
  // Fail closed: the browser cookie is dropped only after Odoo confirmed it destroyed the session, so a failed
  // upstream never leaves a live Odoo session behind a client that believes it logged out.
  const failed = () => createError({ statusCode: 502, ...(bound ? { message: 'tenant_logout_failed' } : { statusMessage: 'logout_failed' }) })
  const body = await upstream.json().catch(() => { throw failed() }) as { error?: unknown }
  if (!upstream.ok || body.error) throw failed()
  const secure = authCookiesAreSecure(event, identityHeaders)
  forwardAuthCookies(event, upstream.headers, secure)
  deleteCookie(event, 'session_id', { path: '/', secure })
  setResponseStatus(event, 204)
  return null
})
