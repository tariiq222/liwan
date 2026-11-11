import { assertPublicMutationOrigin, pickCheckBody } from '../../utils/invitation-accept'
import { customerControlBase, invitationClientHeaders } from '../../utils/customer-commercial'
import { boundedTenantBody, withTenantBody } from '../../utils/tenantTransport'

// Public, read-only pre-check for the invitation page. Answers {usable} and nothing else: an unknown,
// malformed, expired, used or revoked token all give usable:false, so it reveals what accept already would.
// A failed check is 503 and the page then shows the form anyway (accept still validates).
// Never log or echo the token.
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event) as { customerCommercialPublicOrigin?: string; customerCommercialControlUrl?: string; customerCommercialIssuer?: string; customerCommercialServiceKey?: string }
  setResponseHeader(event, 'cache-control', 'no-store')
  assertPublicMutationOrigin(event, config)
  const base = customerControlBase(config)
  // Bound chunked uploads before parsing, separately from the effect's own deadline.
  const raw = await withTenantBody(event, 'public', () => boundedTenantBody(event, 2 * 1024))
  let parsed: unknown
  try { parsed = JSON.parse(raw?.toString('utf8') ?? '') } catch { parsed = null }
  const body = pickCheckBody(parsed)
  if (!body) return { usable: false }
  try {
    const target = new URL('/v1/invitations/check', base)
    const response = await $fetch<{ usable?: unknown }>(target.toString(), {
      method: 'POST', body: JSON.stringify(body), headers: { ...invitationClientHeaders(event, config, target), 'content-type': 'application/json', accept: 'application/json' },
      redirect: 'error', signal: AbortSignal.timeout(10000),
    })
    return { usable: response?.usable === true }
  } catch {
    throw createError({ statusCode: 503, data: { code: 'unavailable', message: 'Service unavailable' } })
  }
})
