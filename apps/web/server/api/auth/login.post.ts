import { tenantTransport } from '../../utils/tenantTransport'
import { tenantRequest, tenantUpstreamHeaders } from '../../utils/tenantRequest'

export default defineEventHandler(async (event) => {
  assertSameSiteJson(event)
  const { login, password } = await readBody<{ login?: string; password?: string }>(event)
  if (!login || !password) {
    throw createError({ statusCode: 400, data: { code: 'missing_credentials' } })
  }
  const { odooUrl, odooDb } = useRuntimeConfig(event)
  const tenant = tenantRequest(event)

  const send = tenant ? (options: { method: string; headers: Record<string, string>; body: string }) => tenantTransport(event, odooUrl, '/web/session/authenticate', options) : (options: RequestInit) => fetch(`${odooUrl}/web/session/authenticate`, options)
  const upstream = await send({
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...tenantUpstreamHeaders(event) },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { db: tenant?.database ?? odooDb, login, password } }),
  })
  const body = await upstream.json() as { result?: { uid?: number | null }; error?: unknown }

  if (body.error || body.result?.uid === undefined) {
    // Code only, no message: the *client* owns the wording so it lands in the
    // active locale. A literal here was rendered verbatim, so an `en` user was
    // shown Arabic.
    throw createError({ statusCode: 401, data: { code: 'invalid_credentials' } })
  }

  // Odoo answers this hop over plain http and marks the cookie accordingly; when the
  // browser reached us over https (directly or through Caddy) it must carry Secure.
  const https = getRequestProtocol(event) === 'https' || getRequestHeader(event, 'x-forwarded-proto') === 'https'
  for (const cookie of upstream.headers.getSetCookie()) {
    appendResponseHeader(event, 'set-cookie', https && !/;\s*secure\b/i.test(cookie) ? `${cookie}; Secure` : cookie)
  }

  if (body.result.uid === null) {
    // MFA pending: the cookie above now carries pre_uid/pre_login, not a real session.
    return { ok: false as const, mfa: 'totp' as const }
  }
  return { ok: true as const }
})
