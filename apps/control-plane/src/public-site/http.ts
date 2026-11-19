import { isIP } from 'node:net'
import type { IncomingHttpHeaders } from 'node:http'
import { z } from 'zod'
import type { Pool } from 'pg'
import { publicContactSchema } from '@liwan/commercial-contracts'
import { verifyServiceRequest } from '@liwan/commercial-contracts/server'
import { transaction } from '../db.js'
import { consumeNonce } from '../commercial/customer-http.js'
import { CommercialHttpError } from '../commercial/lifecycle.js'
import { parseBody } from '../commercial/http.js'
import { isFreeMailAddress } from '../signup/free-mail.js'
import { companyDomain } from '../signup/company-domain.js'
import type { HumanCheck } from '../signup/human-check.js'
import { contactRefusalCode, storeContactRequest } from './contact-requests.js'
import { loadPublicPricing } from './pricing.js'

export const PUBLIC_PRICING_PATH = '/v1/customer/public/pricing'
export const PUBLIC_CONTACT_PATH = '/v1/customer/public/contact'
export const isPublicSiteEndpoint = (pathname: string) => pathname === PUBLIC_PRICING_PATH || pathname === PUBLIC_CONTACT_PATH
/** A message of 2000 characters in Arabic is up to 6000 bytes, beside the other fields and a 2048-character token. */
export const PUBLIC_CONTACT_BODY_LIMIT = 12288
/** Per signed visitor address: 5 messages in ten minutes. */
export const CONTACT_VISITOR_LIMIT = { max: 5, windowMs: 600_000 }
/** The one budget of every pricing read together, so a flood of them cannot keep the database busy. */
export const PRICING_GLOBAL_LIMIT = { max: 120, windowMs: 60_000 }
/** Human checks in flight at once; each one waits on an outside service for up to its timeout. */
const MAX_IN_FLIGHT = 8
const CLIENT_HEADER = 'x-liwan-client-ip'
const noBody = z.strictObject({})

/** Public answers: a fixed table, never error text. The contact codes are the ones the marketing site has messages for. */
const ANSWERS: Record<string, { status: number; message: string }> = {
  forbidden: { status: 403, message: 'Request not accepted' },
  rate_limited: { status: 429, message: 'Too many requests' },
  validation_failed: { status: 422, message: 'Request could not be accepted' },
  invalid_email: { status: 422, message: 'Request could not be accepted' },
  invalid_mobile: { status: 422, message: 'Request could not be accepted' },
  consent_required: { status: 422, message: 'Request could not be accepted' },
  business_email_required: { status: 422, message: 'Request could not be accepted' },
  turnstile_required: { status: 422, message: 'Human check required' },
  turnstile_failed: { status: 422, message: 'Human check failed' },
  unavailable: { status: 503, message: 'Service unavailable' },
}
const refuse = (code: keyof typeof ANSWERS) => ({ status: ANSWERS[code]!.status, data: { code, message: ANSWERS[code]!.message } })

type Service = { issuer?: string; key?: string }
type Options = {
  service: Service; humanCheck?: HumanCheck; planId?: string; notifyEmail?: string
  overLimit: (key: string, limit: { max: number; windowMs: number }) => boolean; bucket: (address: string) => string
}

/** The visitor address of a contact request, or null unless the Nuxt server signed it with the body. No address, no request: a socket
 *  fallback would put every visitor in the Nuxt server's own bucket. */
export function verifiedContactAddress(headers: IncomingHttpHeaders, raw: string, service: Service): string | null {
  const ip = headers[CLIENT_HEADER]
  if (typeof ip !== 'string' || !isIP(ip) || !service.issuer || !service.key) return null
  const signed = verifyServiceRequest({ method: 'POST', path: PUBLIC_CONTACT_PATH, body: `liwan-public-contact:${ip}\n${raw}`, headers, key: service.key, anonymous: true })
  return signed?.issuer === service.issuer ? ip : null
}

const signedPricing = (headers: IncomingHttpHeaders, raw: string, service: Service) =>
  service.issuer && service.key
    ? verifyServiceRequest({ method: 'POST', path: PUBLIC_PRICING_PATH, body: `liwan-public-pricing:\n${raw}`, headers, key: service.key, anonymous: true })
    : null

/**
 * The two public reads and writes of the marketing site, both signed by the Nuxt server (the control plane is never public).
 * Pricing is the published sign-up offer in the site's shape. A contact request is checked in this order, cheapest first:
 * signature, per-address budget, shape, business address, human check; then it is stored with its owner notice.
 * Nothing the visitor typed is logged or echoed.
 */
export function publicSiteHandler(pool: Pool, o: Options) {
  let inFlight = 0
  const claim = async (signed: { issuer: string } & Parameters<typeof consumeNonce>[1]) => {
    try { await transaction(pool, client => consumeNonce(client, signed)) } catch (e) { return e instanceof CommercialHttpError ? refuse('forbidden') : refuse('unavailable') }
    return null
  }

  async function pricing(raw: string, headers: IncomingHttpHeaders) {
    const signed = signedPricing(headers, raw, o.service)
    if (!signed) return refuse('forbidden')
    if (o.overLimit(PUBLIC_PRICING_PATH, PRICING_GLOBAL_LIMIT)) return refuse('rate_limited')
    const refused = await claim(signed)
    if (refused) return refused
    try { parseBody(raw, noBody) } catch { return refuse('validation_failed') }
    if (!o.planId) return refuse('unavailable')
    try { return { status: 200, data: await transaction(pool, client => loadPublicPricing(client, o.planId!)) } } catch { return refuse('unavailable') }
  }

  async function contact(raw: string, headers: IncomingHttpHeaders) {
    const address = verifiedContactAddress(headers, raw, o.service)
    if (!address) return refuse('forbidden')
    if (o.overLimit(`${PUBLIC_CONTACT_PATH}|${o.bucket(address)}`, CONTACT_VISITOR_LIMIT)) return refuse('rate_limited')
    if (inFlight >= MAX_IN_FLIGHT) return refuse('unavailable')
    inFlight++
    try {
      const signed = verifyServiceRequest({ method: 'POST', path: PUBLIC_CONTACT_PATH, body: `liwan-public-contact:${address}\n${raw}`, headers, key: o.service.key!, anonymous: true })!
      const refused = await claim(signed)
      if (refused) return refused
      if (!o.notifyEmail || !o.humanCheck) return refuse('unavailable')
      let json: unknown
      try { json = JSON.parse(raw) } catch { return refuse('validation_failed') }
      const parsed = publicContactSchema.safeParse(json)
      if (!parsed.success) return refuse(contactRefusalCode(parsed.error) as keyof typeof ANSWERS)
      const input = parsed.data
      if (isFreeMailAddress(input.email) || companyDomain(input.email) === null) return refuse('business_email_required')
      let passed: boolean
      try { passed = await o.humanCheck(input.turnstile_token, address) } catch { return refuse('unavailable') }
      if (!passed) return refuse('turnstile_failed')
      await storeContactRequest(pool, input)
      return { status: 201, data: { ok: true } }
    } catch { return refuse('unavailable') } finally { inFlight-- }
  }

  return async (pathname: string, method: string, raw: string, headers: IncomingHttpHeaders): Promise<{ status: number; data: unknown }> => {
    if (method !== 'POST' || !isPublicSiteEndpoint(pathname)) return { status: 404, data: { code: 'not_found', message: 'Endpoint not found' } }
    return pathname === PUBLIC_PRICING_PATH ? pricing(raw, headers) : contact(raw, headers)
  }
}
