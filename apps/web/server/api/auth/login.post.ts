export default defineEventHandler(async (event) => {
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
    throw createError({ statusCode: 401, data: { code: 'invalid_credentials', message: 'بيانات الدخول غير صحيحة' } })
  }
  for (const cookie of upstream.headers.getSetCookie()) {
    appendResponseHeader(event, 'set-cookie', cookie)
  }
  return { ok: true }
})
