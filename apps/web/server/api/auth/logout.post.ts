import { tenantTransport } from '../../utils/tenantTransport'
import { tenantRequest, tenantUpstreamHeaders } from '../../utils/tenantRequest'

export default defineEventHandler(async (event) => {
  assertSameSiteJson(event)
  const { odooUrl } = useRuntimeConfig(event)
  const cookie = getHeader(event, 'cookie') ?? ''
  const bound = Boolean(tenantRequest(event) || process.env.WEBVUE_RELEASE_ROUTES_DIR)
  const send = bound ? (options: { method: string; headers: Record<string, string>; body: string }) => tenantTransport(event, odooUrl, '/web/session/destroy', options) : (options: RequestInit) => fetch(`${odooUrl}/web/session/destroy`, options)
  const upstream = await send({
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie, ...tenantUpstreamHeaders(event) },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: {} }),
  }).catch((error) => { if (bound) throw error; return undefined })
  if (bound && (!upstream?.ok || (await upstream.json() as { error?: unknown }).error)) throw createError({ statusCode: 502, message: 'tenant_logout_failed' })
  for (const cookie of bound ? upstream!.headers.getSetCookie() : []) appendResponseHeader(event, 'set-cookie', cookie)
  deleteCookie(event, 'session_id', { path: '/' })
  setResponseStatus(event, 204)
  return null
})
