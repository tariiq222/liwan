import { boundedTenantJson, tenantTransport, withTenantBody, withUpstreamSlot } from '../../utils/tenantTransport'
import { tenantRequest } from '../../utils/tenantRequest'
import { uiLocaleHeaders } from '../../utils/uiLocale'

// A profile patch carries a locale code and a zone name; 4 KiB is generous for both.
const MAX_PROFILE_BODY = 4 * 1024

export default defineEventHandler(async (event) => {
  assertSameSiteJson(event)
  return withTenantBody(event, 'session', async () => {
    const payload = await boundedTenantJson<Record<string, unknown>>(event, MAX_PROFILE_BODY)
    const { odooUrl } = useRuntimeConfig(event)
    const cookie = getHeader(event, 'cookie') ?? ''
    const bound = Boolean(tenantRequest(event) || process.env.LIWAN_RELEASE_ROUTES_DIR)
    const send = bound
      ? (options: { method: string; headers: Record<string, string>; body: string }) => tenantTransport(event, odooUrl, '/api/v1/me/profile', options)
      : (options: RequestInit) => withUpstreamSlot(signal => fetch(`${odooUrl}/api/v1/me/profile`, { ...options, signal }), event)
    const upstream = await send({
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie, ...uiLocaleHeaders(event) },
      body: JSON.stringify(payload),
    })
    const body = await upstream.json().catch(() => ({})) as { code?: string; field?: string }
    if (!upstream.ok) {
      // Machine code and field only: the page owns the wording, in the active locale.
      throw createError({ statusCode: upstream.status, data: { code: body.code ?? 'invalid', field: body.field } })
    }
    return body
  })
})
