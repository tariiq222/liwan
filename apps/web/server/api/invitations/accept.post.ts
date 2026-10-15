import { assertPublicMutationOrigin, pickAcceptBody } from '../../utils/invitation-accept'
import { customerControlBase } from '../../utils/customer-commercial'

// Public route: the control-plane endpoint is unauthenticated, so no service signature.
// Never log or echo the token or password.
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event) as { customerCommercialPublicOrigin?: string; customerCommercialControlUrl?: string }
  setResponseHeader(event, 'cache-control', 'no-store')
  assertPublicMutationOrigin(event, config)
  const base = customerControlBase(config)
  if (Number(getHeader(event, 'content-length') ?? 0) > 8 * 1024) throw createError({ statusCode: 413, data: { code: 'payload_too_large', message: 'Request body is too large' } })
  let parsed: unknown
  try { parsed = JSON.parse((await readRawBody(event, 'utf8')) ?? '') } catch { parsed = null }
  const body = pickAcceptBody(parsed)
  if (!body) throw createError({ statusCode: 400, data: { code: 'invalid_invitation', message: 'Invalid invitation' } })
  try {
    const response = await $fetch.raw(new URL('/v1/invitations/accept', base).toString(), {
      method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', accept: 'application/json' },
      // Longer than control-api's own effect wait (215s), so a slow Odoo effect that still succeeds is not reported
      // to the browser as a failure after the password has already changed.
      redirect: 'error', signal: AbortSignal.timeout(230000),
    })
    setResponseStatus(event, response.status)
    const login = (response._data as { login?: unknown } | null)?.login
    return { login: typeof login === 'string' ? login : null }
  } catch (cause: any) {
    const status = Number(cause?.statusCode ?? cause?.response?.status)
    if (status >= 400 && status < 500) throw createError({ statusCode: 400, data: { code: 'invalid_invitation', message: 'Invalid invitation' } })
    throw createError({ statusCode: 503, data: { code: 'unavailable', message: 'Service unavailable' } })
  }
})
