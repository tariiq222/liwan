import { acceptOutcome, assertPublicMutationOrigin, pickAcceptBody } from '../../utils/invitation-accept'
import { customerControlBase, invitationClientHeaders } from '../../utils/customer-commercial'
import { boundedTenantBody, withTenantBody } from '../../utils/tenantTransport'

// Public route: no user signature. Only the visitor's edge-derived address is signed, for the control plane's rate limit.
// Never log or echo the token or password.
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event) as { customerCommercialPublicOrigin?: string; customerCommercialControlUrl?: string; customerCommercialIssuer?: string; customerCommercialServiceKey?: string }
  setResponseHeader(event, 'cache-control', 'no-store')
  assertPublicMutationOrigin(event, config)
  const base = customerControlBase(config)
  // Bound chunked uploads before parsing, separately from the effect's own deadline.
  const raw = await withTenantBody(event, 'public', () => boundedTenantBody(event, 8 * 1024))
  let parsed: unknown
  try { parsed = JSON.parse(raw?.toString('utf8') ?? '') } catch { parsed = null }
  const body = pickAcceptBody(parsed)
  if (!body) throw createError({ statusCode: 400, data: { code: 'invalid_invitation', message: 'Invalid invitation' } })
  try {
    const target = new URL('/v1/invitations/accept', base)
    const response = await $fetch.raw(target.toString(), {
      method: 'POST', body: JSON.stringify(body), headers: { ...invitationClientHeaders(event, config, target), 'content-type': 'application/json', accept: 'application/json' },
      // Longer than control-api's own effect wait (215s), so a slow Odoo effect that still succeeds is not reported
      // to the browser as a failure after the password has already changed.
      redirect: 'error', signal: AbortSignal.timeout(230000),
    })
    setResponseStatus(event, response.status)
    const login = (response._data as { login?: unknown } | null)?.login
    return { login: typeof login === 'string' ? login : null }
  } catch (cause: any) {
    const status = Number(cause?.statusCode ?? cause?.response?.status)
    const outcome = acceptOutcome(status, cause?.data?.code)
    if (outcome) throw createError({ statusCode: outcome.status, data: { code: outcome.code, message: outcome.message } })
    // A rate-limited accept says nothing about the token: it is a temporary outage, so the form and Retry stay.
    if (status >= 400 && status < 500 && status !== 429) throw createError({ statusCode: 400, data: { code: 'invalid_invitation', message: 'Invalid invitation' } })
    throw createError({ statusCode: 503, data: { code: 'unavailable', message: 'Service unavailable' } })
  }
})
