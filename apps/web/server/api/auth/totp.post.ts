import { tenantTransport } from '../../utils/tenantTransport'
import { tenantRequest, tenantUpstreamHeaders } from '../../utils/tenantRequest'

export default defineEventHandler(async (event) => {
  assertSameSiteJson(event)
  const { code } = await readBody<{ code?: string }>(event)
  const { odooUrl } = useRuntimeConfig(event)

  const cookie = getHeader(event, 'cookie') ?? ''
  const send = tenantRequest(event) ? (options: { method: string; headers: Record<string, string>; body: string }) => tenantTransport(event, odooUrl, '/api/v1/auth/totp', options) : (options: RequestInit) => fetch(`${odooUrl}/api/v1/auth/totp`, options)
  const upstream = await send({
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie, ...tenantUpstreamHeaders(event) },
    body: JSON.stringify({ code }),
  })

  // Odoo answers this hop over plain http and marks the cookie accordingly; when the
  // browser reached us over https (directly or through Caddy) it must carry Secure.
  const https = getRequestProtocol(event) === 'https' || getRequestHeader(event, 'x-forwarded-proto') === 'https'
  for (const setCookie of upstream.headers.getSetCookie()) {
    appendResponseHeader(event, 'set-cookie', https && !/;\s*secure\b/i.test(setCookie) ? `${setCookie}; Secure` : setCookie)
  }

  if (!upstream.ok) {
    // Same rule as login.post.ts: pass the code, never a human-readable
    // message — login.vue maps the code to a translated string.
    const data = await upstream.json().catch(() => ({})) as { code?: string }
    throw createError({ statusCode: upstream.status, data: { code: data.code ?? 'invalid_code' } })
  }

  return { ok: true }
})
