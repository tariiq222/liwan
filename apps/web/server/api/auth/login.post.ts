export default defineEventHandler(async (event) => {
  assertSameSiteJson(event)
  const { login, password } = await readBody<{ login?: string; password?: string }>(event)
  if (!login || !password) {
    throw createError({ statusCode: 400, data: { code: 'missing_credentials', message: 'login and password are required' } })
  }
  const { odooUrl, odooDb } = useRuntimeConfig(event)

  const upstream = await fetch(`${odooUrl}/web/session/authenticate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { db: odooDb, login, password } }),
  })
  const body = await upstream.json() as { result?: { uid?: number }; error?: unknown }

  if (body.error || !body.result?.uid) {
    // TODO(phase 1): a TOTP-enabled account currently fails here as invalid_credentials; handle the auth_totp challenge
    throw createError({ statusCode: 401, data: { code: 'invalid_credentials', message: 'بيانات الدخول غير صحيحة' } })
  }
  // Odoo answers this hop over plain http and marks the cookie accordingly; when the
  // browser reached us over https (directly or through Caddy) it must carry Secure.
  const https = getRequestProtocol(event) === 'https' || getRequestHeader(event, 'x-forwarded-proto') === 'https'
  for (const cookie of upstream.headers.getSetCookie()) {
    appendResponseHeader(event, 'set-cookie', https && !/;\s*secure\b/i.test(cookie) ? `${cookie}; Secure` : cookie)
  }
  return { ok: true }
})
