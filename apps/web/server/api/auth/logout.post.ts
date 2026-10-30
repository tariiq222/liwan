import { tenantTransport, withUpstreamSlot } from '../../utils/tenantTransport'
import { tenantRequest, tenantUpstreamHeaders } from '../../utils/tenantRequest'

export default defineEventHandler(async (event) => {
  assertSameSiteJson(event)
  const { odooUrl } = useRuntimeConfig(event)
  const cookie = getHeader(event, 'cookie') ?? ''
  const bound = Boolean(tenantRequest(event) || process.env.LIWAN_RELEASE_ROUTES_DIR)
  const send = bound ? (options: { method: string; headers: Record<string, string>; body: string }) => tenantTransport(event, odooUrl, '/web/session/destroy', options) : (options: RequestInit) => withUpstreamSlot(signal => fetch(`${odooUrl}/web/session/destroy`, { ...options, signal }), event)
  const upstream = await send({
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie, ...tenantUpstreamHeaders(event) },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: {} }),
  })
  // Fail closed: the browser cookie is dropped only after Odoo confirmed it destroyed the session, so a failed
  // upstream never leaves a live Odoo session behind a client that believes it logged out.
  const failed = () => createError({ statusCode: 502, ...(bound ? { message: 'tenant_logout_failed' } : { statusMessage: 'logout_failed' }) })
  const body = await upstream.json().catch(() => { throw failed() }) as { error?: unknown }
  if (!upstream.ok || body.error) throw failed()
  for (const cookie of upstream.headers.getSetCookie()) appendResponseHeader(event, 'set-cookie', cookie)
  deleteCookie(event, 'session_id', { path: '/' })
  setResponseStatus(event, 204)
  return null
})
