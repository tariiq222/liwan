import { assertPublicMutationOrigin, pickReissueBody } from '../../utils/invitation-accept'
import { customerControlBase, invitationReissueHeaders } from '../../utils/customer-commercial'
import { boundedTenantBody, withTenantBody } from '../../utils/tenantTransport'

// Public: a manager whose invitation expired or never arrived asks for a new one. The answer is {ok:true} whether or not the address
// is waiting for an invitation; the control plane mails the address it holds on record, never this one, and never to another tenant:
// the tenant is the one this host is bound to. No cookie is read or forwarded. Never log or echo the address.
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event) as { customerCommercialPublicOrigin?: string; customerCommercialControlUrl?: string; customerCommercialIssuer?: string; customerCommercialServiceKey?: string; customerCommercialTenantId?: string }
  setResponseHeader(event, 'cache-control', 'no-store')
  assertPublicMutationOrigin(event, config)
  const base = customerControlBase(config)
  const raw = await withTenantBody(event, 'public', () => boundedTenantBody(event, 1024))
  let parsed: unknown
  try { parsed = JSON.parse(raw?.toString('utf8') ?? '') } catch { parsed = null }
  const body = pickReissueBody(parsed)
  if (!body) throw createError({ statusCode: 400, data: { code: 'invalid', message: 'Invalid request' } })
  try {
    const target = new URL('/v1/invitations/reissue', base)
    await $fetch.raw(target.toString(), {
      method: 'POST', body: JSON.stringify(body), headers: { ...invitationReissueHeaders(event, config, target), 'content-type': 'application/json', accept: 'application/json' },
      redirect: 'error', signal: AbortSignal.timeout(10000),
    })
    setResponseStatus(event, 202)
    return { ok: true }
  } catch (cause: any) {
    if (cause?.statusCode === 503 && cause?.data?.code === 'unavailable') throw cause
    const status = Number(cause?.statusCode ?? cause?.response?.status)
    if (status === 429) throw createError({ statusCode: 429, data: { code: 'rate_limited', message: 'Too many requests' } })
    throw createError({ statusCode: 503, data: { code: 'unavailable', message: 'Service unavailable' } })
  }
})
