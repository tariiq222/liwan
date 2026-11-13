import { isIP } from 'node:net'
import { z } from 'zod'
import type { IncomingHttpHeaders } from 'node:http'
import type { Pool } from 'pg'
import { verifyServiceRequest } from '@liwan/commercial-contracts/server'
import { transaction } from '../db.js'
import type { HumanCheck } from '../signup/human-check.js'
import { consumeNonce } from './customer-http.js'
import { CommercialHttpError } from './lifecycle.js'
import { parseBody } from './http.js'
import { queueWorkspaceLookup } from './workspace-lookup.js'

export const FIND_WORKSPACE_PATH = '/v1/customer/find-workspace'
/** The body carries the typed address (254) and a Turnstile token (2048), as sign-up's start body does. */
export const FIND_WORKSPACE_BODY_LIMIT = 4096
/** Per signed visitor address: 5 requests in ten minutes. */
export const FIND_WORKSPACE_VISITOR_LIMIT = { max: 5, windowMs: 600_000 }
/** Human checks in flight at once; each one waits on an outside service for up to its timeout. */
const MAX_IN_FLIGHT = 8
const CLIENT_HEADER = 'x-liwan-client-ip'

const body = z.strictObject({ email: z.string().trim().min(3).max(254), human_token: z.string().min(1).max(2048) })

/** Public answers: a fixed table, never error text. */
const ANSWERS: Record<string, { status: number; message: string }> = {
  invalid: { status: 400, message: 'Request could not be accepted' },
  forbidden: { status: 403, message: 'Request not accepted' },
  rate_limited: { status: 429, message: 'Too many requests' },
  human_check_failed: { status: 422, message: 'Human check failed' },
  human_check_unavailable: { status: 503, message: 'Human check unavailable' },
  unavailable: { status: 503, message: 'Service unavailable' },
}
const refuse = (code: keyof typeof ANSWERS) => ({ status: ANSWERS[code]!.status, data: { code, message: ANSWERS[code]!.message } })

/** The visitor address of a request, or null unless the Nuxt server signed it, with the body, using the customer service key.
 *  The common host has no tenant: the address is the only thing signed besides the body. No address, no request: a socket
 *  fallback would put every visitor in the Nuxt server's own bucket. */
export function verifiedLookupAddress(headers: IncomingHttpHeaders, raw: string, service: { issuer?: string; key?: string }): string | null {
  const ip = headers[CLIENT_HEADER]
  if (typeof ip !== 'string' || !isIP(ip) || !service.issuer || !service.key) return null
  const signed = verifyServiceRequest({ method: 'POST', path: FIND_WORKSPACE_PATH, body: `liwan-find-workspace:${ip}\n${raw}`, headers, key: service.key, anonymous: true })
  return signed?.issuer === service.issuer ? ip : null
}

/** Public: POST /v1/customer/find-workspace {email, human_token}, 202 {ok:true} whether or not the address manages a workspace.
 *  It checks the human token (fail closed) and only queues the request; the worker does the lookup, so the answer and its
 *  timing never depend on the address. `overLimit` budgets the visitor in the caller's limiter. */
export function workspaceLookupHandler(pool: Pool, o: { service: { issuer?: string; key?: string }; humanCheck?: HumanCheck; overLimit: (key: string, limit: { max: number; windowMs: number }) => boolean; bucket: (address: string) => string }) {
  let inFlight = 0
  return async (method: string, raw: string, headers: IncomingHttpHeaders): Promise<{ status: number; data: unknown }> => {
    if (method !== 'POST') return { status: 404, data: { code: 'not_found', message: 'Endpoint not found' } }
    const address = verifiedLookupAddress(headers, raw, o.service)
    if (!address) return refuse('forbidden')
    if (o.overLimit(`${FIND_WORKSPACE_PATH}|${o.bucket(address)}`, FIND_WORKSPACE_VISITOR_LIMIT)) return refuse('rate_limited')
    if (inFlight >= MAX_IN_FLIGHT) return refuse('unavailable')
    inFlight++
    try {
      const signed = verifyServiceRequest({ method: 'POST', path: FIND_WORKSPACE_PATH, body: `liwan-find-workspace:${address}\n${raw}`, headers, key: o.service.key!, anonymous: true })!
      try { await transaction(pool, client => consumeNonce(client, signed)) } catch (e) { return e instanceof CommercialHttpError ? refuse('forbidden') : refuse('unavailable') }
      let input: z.infer<typeof body>
      try { input = parseBody(raw, body) } catch { return refuse('invalid') }
      if (!o.humanCheck) return refuse('human_check_unavailable')
      let passed: boolean
      try { passed = await o.humanCheck(input.human_token, address) } catch { return refuse('human_check_unavailable') }
      if (!passed) return refuse('human_check_failed')
      await queueWorkspaceLookup(pool, { email: input.email, client_address: address })
      return { status: 202, data: { ok: true } }
    } catch { return refuse('unavailable') } finally { inFlight-- }
  }
}
