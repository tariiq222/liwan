import { assertPublicMutationOrigin, pickCheckBody } from '../../utils/invitation-accept'
import { customerControlBase } from '../../utils/customer-commercial'

// Public, read-only pre-check for the invitation page. Answers {usable} and nothing else: an unknown,
// malformed, expired, used or revoked token all give usable:false, so it reveals what accept already would.
// A failed check is 503 and the page then shows the form anyway (accept still validates).
// Never log or echo the token.
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event) as { customerCommercialPublicOrigin?: string; customerCommercialControlUrl?: string }
  setResponseHeader(event, 'cache-control', 'no-store')
  assertPublicMutationOrigin(event, config)
  const base = customerControlBase(config)
  if (Number(getHeader(event, 'content-length') ?? 0) > 2 * 1024) throw createError({ statusCode: 413, data: { code: 'payload_too_large', message: 'Request body is too large' } })
  let parsed: unknown
  try { parsed = JSON.parse((await readRawBody(event, 'utf8')) ?? '') } catch { parsed = null }
  const body = pickCheckBody(parsed)
  if (!body) return { usable: false }
  try {
    const response = await $fetch<{ usable?: unknown }>(new URL('/v1/invitations/check', base).toString(), {
      method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', accept: 'application/json' },
      redirect: 'error', signal: AbortSignal.timeout(10000),
    })
    return { usable: response?.usable === true }
  } catch {
    throw createError({ statusCode: 503, data: { code: 'unavailable', message: 'Service unavailable' } })
  }
})
