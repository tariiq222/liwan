import { boundedTenantJson, tenantTransport, withTenantBody, withUpstreamSlot } from '../../utils/tenantTransport'
import { tenantRequest } from '../../utils/tenantRequest'
import { authCookiesAreSecure, forwardAuthCookies } from '../../utils/authCookies'
import { authUpstreamHeaders } from '../../utils/authUpstreamHeaders'
import { uiLocaleHeaders } from '../../utils/uiLocale'

// Credential JSON is small; 64KiB leaves generous room for long credentials and encoding.
const MAX_LOGIN_BODY = 64 * 1024

export default defineEventHandler(async (event) => {
  assertSameSiteJson(event)
  return withTenantBody(event, 'public', async () => {
    const { login, password } = await boundedTenantJson<{ login?: string; password?: string }>(event, MAX_LOGIN_BODY)
    if (!login || !password) {
      throw createError({ statusCode: 400, data: { code: 'missing_credentials', message: 'Login and password are required.' } })
    }
    const { odooUrl, odooDb, authProxyClientIpHeader } = useRuntimeConfig(event)
    const tenant = tenantRequest(event)

    const send = tenant || process.env.LIWAN_RELEASE_ROUTES_DIR ? (options: { method: string; headers: Record<string, string>; body: string }) => tenantTransport(event, odooUrl, '/web/session/authenticate', options) : (options: RequestInit) => withUpstreamSlot(signal => fetch(`${odooUrl}/web/session/authenticate`, { ...options, signal }), event)
    const identityHeaders = authUpstreamHeaders(event, authProxyClientIpHeader)
    const upstream = await send({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...uiLocaleHeaders(event), ...identityHeaders },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { db: tenant?.database ?? odooDb, login, password } }),
    })
    // A proxy error page or an empty body is an unavailable upstream, never a raw SyntaxError.
    const body = await upstream.json().catch(() => {
      throw createError({ statusCode: 502, message: 'tenant_upstream_unavailable', data: { code: 'tenant_upstream_unavailable' } })
    }) as { result?: { uid?: number | null }; error?: { data?: { name?: unknown } } }

    // Odoo raises LiwanTenantSuspended only after the password checked out, so naming
    // the suspension reveals nothing to a caller without valid credentials.
    const errorName = body.error?.data?.name
    if (typeof errorName === 'string' && errorName.endsWith('.LiwanTenantSuspended')) {
      throw createError({ statusCode: 403, data: { code: 'tenant_suspended' } })
    }
    if (body.error || body.result?.uid === undefined) {
      // Code only, no message: the *client* owns the wording so it lands in the
      // active locale. A literal here was rendered verbatim, so an `en` user was
      // shown Arabic.
      throw createError({ statusCode: 401, data: { code: 'invalid_credentials' } })
    }

    forwardAuthCookies(event, upstream.headers, authCookiesAreSecure(event, identityHeaders))

    if (body.result.uid === null) {
      // The second step is mandatory for every account: the cookie above now carries pre_uid/pre_login and no
      // real session, and the page continues with a 6-digit code.
      return { ok: false as const, mfa: 'code' as const }
    }
    return { ok: true as const }
  })
})
