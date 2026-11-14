import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { isIP } from 'node:net'
import type { H3Event } from 'h3'
import { MeSchema } from '@liwan/contracts'
import { signServiceRequest } from '@liwan/commercial-contracts/server'
import { tenantRequest } from './tenantRequest'
import { boundedTenantBody, tenantTransport, withTenantBody } from './tenantTransport'
import { FIND_WORKSPACE_API, isProspectRequest, PROSPECT_TENANT, SIGNUP_API } from './prospectHost'
import { deriveCustomerCapabilities, type CustomerCommercialCapability } from '../../app/utils/customerCapabilities'

type CustomerConfig = {
  customerCommercialEnabled?: boolean | string
  customerCommercialControlUrl?: string
  customerCommercialServiceKey?: string
  customerCommercialIssuer?: string
  customerCommercialPublicOrigin?: string
  /** Dedicated (non-shared) deployments only: the single tenant this web serves. Shared mode uses the host binding. */
  customerCommercialTenantId?: string
  odooUrl?: string
}

export type CustomerPrincipal = { actor_id: string; kind: 'customer'; tenant_id: string; capabilities: CustomerCommercialCapability[] }

export const CSRF_COOKIE = 'liwan_csrf'
export const CSRF_HEADER = 'x-liwan-csrf'
/** Keys that carry identity or authority. They are only ever derived server-side, so a client sending one is rejected. */
export const FORBIDDEN_KEYS = new Set(['tenant_id', 'customer_id', 'capabilities', 'capability', 'principal', 'actor_id', 'issuer', 'kind_principal', 'tenantid', 'customerid'])

function fail(statusCode: number, code: string, message: string): never {
  throw createError({ statusCode, data: { code, message } })
}

export function customerCommercialEnabled(config: CustomerConfig): boolean {
  return config.customerCommercialEnabled === true || config.customerCommercialEnabled === 'true'
}

export function customerControlBase(config: CustomerConfig): URL {
  const unavailable = () => fail(503, 'commercial_unavailable', 'Subscription service is not configured')
  if (!config.customerCommercialControlUrl) return unavailable()
  let url: URL
  try { url = new URL(config.customerCommercialControlUrl) } catch { return unavailable() }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) return unavailable()
  if (url.username || url.password) return unavailable()
  return url
}

/** Rejects (400) any identity/authority field anywhere in query or body, at any depth. */
export function assertNoForgedFields(value: unknown, depth = 0): void {
  if (depth > 8 || value === null || typeof value !== 'object') return
  if (Array.isArray(value)) { for (const v of value) assertNoForgedFields(v, depth + 1); return }
  for (const [key, v] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) fail(400, 'forbidden_field', 'Identity fields are not accepted from the client')
    assertNoForgedFields(v, depth + 1)
  }
}

type Route = { method: 'GET' | 'POST'; pattern: RegExp }
const ROUTES: Route[] = [
  { method: 'GET', pattern: /^subscription$/ },
  { method: 'GET', pattern: /^catalog$/ },
  { method: 'POST', pattern: /^quotes$/ },
  { method: 'POST', pattern: /^trial$/ },
  { method: 'POST', pattern: /^trial\/convert$/ },
  { method: 'GET', pattern: /^trial\/end-preview$/ },
  { method: 'POST', pattern: /^trial\/retry$/ },
  { method: 'POST', pattern: /^preview$/ },
  { method: 'POST', pattern: /^orders$/ },
  { method: 'GET', pattern: /^orders\/[A-Za-z0-9_-]{1,128}$/ },
  { method: 'POST', pattern: /^orders\/[A-Za-z0-9_-]{1,128}\/payment-attempts$/ },
  { method: 'POST', pattern: /^orders\/[A-Za-z0-9_-]{1,128}\/cancel$/ },
  { method: 'GET', pattern: /^invoices$/ },
  { method: 'GET', pattern: /^invoices\/[A-Za-z0-9_-]{1,128}$/ },
  // A2: where to transfer while an invoice is unpaid; reads no more than the invoice itself.
  { method: 'GET', pattern: /^invoices\/[A-Za-z0-9_-]{1,128}\/bank-transfer$/ },
  // "I made the transfer": records a claim only; the vendor confirms the transfer by hand.
  { method: 'POST', pattern: /^invoices\/[A-Za-z0-9_-]{1,128}\/bank-transfer-claim$/ },
  { method: 'GET', pattern: /^branches$/ },
  { method: 'POST', pattern: /^branch-quotes$/ },
  { method: 'GET', pattern: /^usage$/ },
  { method: 'POST', pattern: /^auto-renew$/ },
  // The customer's saved cards: a masked list, and removal (the control plane deletes the token at the provider first).
  { method: 'GET', pattern: /^payment-methods$/ },
  { method: 'POST', pattern: /^payment-methods\/[A-Za-z0-9_-]{1,128}\/remove$/ },
  { method: 'POST', pattern: /^subscription\/(cancel|resume)$/ },
  // Deleting the workspace: read the request, ask for the emailed code, confirm with it, or withdraw. The vendor never asks or confirms.
  { method: 'GET', pattern: /^deletion$/ },
  { method: 'POST', pattern: /^deletion\/(request|confirm|withdraw)$/ },
]
/** Capability each route needs (authoritative check also repeats in the control plane). */
const NEEDS: Array<[RegExp, string, CustomerCommercialCapability]> = [
  [/^deletion\/(request|confirm|withdraw)$/, 'POST', 'tenant.delete'],
  [/^quotes$|^orders|^auto-renew$|^subscription\/(cancel|resume)$|^trial(\/(convert|retry))?$|^payment-methods\/[^/]+\/remove$/, 'POST', 'subscription.manage'],
  [/^invoices\/[^/]+\/bank-transfer-claim$/, 'POST', 'subscription.manage'],
  [/^preview$/, 'POST', 'subscription.read'],
  [/^branch-quotes$/, 'POST', 'branches.manage'],
  [/^invoices|^payment-methods$/, 'GET', 'billing.read'],
  [/./, 'GET', 'subscription.read'],
]

/** Returns the control-plane path (without query) for an allowed route, or null. Path traversal and unknown routes are null. */
export function customerRoute(method: string, rest: string): { upstream: string; needs: CustomerCommercialCapability } | null {
  const m = method.toUpperCase()
  const clean = rest.replace(/^\/+|\/+$/g, '')
  if (clean.includes('..') || clean.includes('//') || clean.includes('%')) return null
  const hit = ROUTES.find(r => r.method === m && r.pattern.test(clean))
  if (!hit) return null
  const needs = NEEDS.find(([re, mm]) => mm === m && re.test(clean))![2]
  return { upstream: `/v1/customer/${clean}`, needs }
}

/** Double-submit CSRF: header must equal cookie (constant time). */
export function csrfMatches(header: string | undefined, cookie: string | undefined): boolean {
  if (!header || !cookie || header.length < 32) return false
  const a = Buffer.from(header); const b = Buffer.from(cookie)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function assertCustomerMutationOrigin(event: H3Event, config: CustomerConfig): void {
  const contentType = getHeader(event, 'content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') fail(415, 'unsupported_media_type', 'JSON requests are required')
  const site = getHeader(event, 'sec-fetch-site')
  if (site && site !== 'same-origin') fail(403, 'cross_site_request', 'Cross-site request rejected')
  // Shared mode: the expected origin is the resolver-verified tenant host (tenantRequest throws unless the
  // proxy token, registry match and revision all verify). Dedicated mode: the configured public origin.
  const bound = tenantRequest(event)
  let expected: URL
  try { expected = new URL(bound ? `https://${bound.host.toLowerCase()}` : (config.customerCommercialPublicOrigin ?? '')) } catch { return fail(503, 'commercial_unavailable', 'Subscription origin is not configured') }
  if (!['http:', 'https:'].includes(expected.protocol)) fail(503, 'commercial_unavailable', 'Subscription origin is not configured')
  const origin = getHeader(event, 'origin')
  if (!origin || origin !== expected.origin) fail(403, 'cross_site_request', 'Request origin rejected')
  if (!csrfMatches(getHeader(event, CSRF_HEADER), getCookie(event, CSRF_COOKIE))) fail(403, 'csrf_failed', 'CSRF token rejected')
}

export function ensureCsrfCookie(event: H3Event): void {
  if (getCookie(event, CSRF_COOKIE)) return
  setCookie(event, CSRF_COOKIE, randomBytes(24).toString('hex'), { sameSite: 'strict', secure: getRequestURL(event).protocol === 'https:', httpOnly: false, path: '/' })
}

/** Browser-side token issue: a first read during SSR cannot deliver its Set-Cookie, so the page asks for it before its first mutation. */
export function issueCsrfCookie(event: H3Event): null {
  if (!customerCommercialEnabled(useRuntimeConfig(event) as CustomerConfig)) fail(404, 'not_found', 'Not found')
  ensureCsrfCookie(event)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  setResponseStatus(event, 204)
  return null
}

const WINDOW_MS = 60_000
const MAX_MUTATIONS = 20
const buckets = new Map<string, number[]>()
export function rateLimitMutation(sessionKey: string, now = Date.now()): boolean {
  const key = createHash('sha256').update(sessionKey).digest('hex')
  const recent = (buckets.get(key) ?? []).filter(t => now - t < WINDOW_MS)
  if (recent.length >= MAX_MUTATIONS) { buckets.set(key, recent); return false }
  recent.push(now); buckets.set(key, recent)
  if (buckets.size > 5000) for (const [k, v] of buckets) if (!v.some(t => now - t < WINDOW_MS)) buckets.delete(k)
  return true
}
export function resetRateLimitForTests() { buckets.clear(); returnHits.clear() }

// The payment return route is unauthenticated, so every key below is chosen by the caller or the network and
// must never share the signed-in users' `buckets`. This store has a fixed size and evicts its oldest key first.
export const PAYMENT_RETURN_LIMITS = { perClient: 30, perAttempt: 5, global: 300, windowMs: 60_000, maxKeys: 2000 }
const returnHits = new Map<string, number[]>()
export function paymentReturnStoreSize() { return returnHits.size }
/** Counts one return against its client+tenant, its attempt and the whole route; refuses without recording when any is full. */
export function allowPaymentReturn(client: string, attempt: string, now = Date.now()): boolean {
  const limits = PAYMENT_RETURN_LIMITS
  const keys: Array<[string, number]> = [['global', limits.global], [`client:${client}`, limits.perClient], [`attempt:${attempt}`, limits.perAttempt]]
  const recent = keys.map(([key]) => (returnHits.get(key) ?? []).filter(t => now - t < limits.windowMs))
  if (keys.some(([, max], i) => recent[i]!.length >= max)) return false
  keys.forEach(([key], i) => {
    // Re-inserting moves the key to the newest end of the Map, which is the eviction order.
    returnHits.delete(key)
    returnHits.set(key, [...recent[i]!, now])
  })
  while (returnHits.size > limits.maxKeys) returnHits.delete(returnHits.keys().next().value!)
  return true
}
/** The edge-supplied client address, or 'unknown'; a value that is not an IP is never used as a key. */
function paymentReturnClient(event: H3Event): string {
  const ip = getHeader(event, 'x-liwan-client-ip')
  return ip && isIP(ip) ? ip : 'unknown'
}

export const encodePrincipal = (p: CustomerPrincipal) => Buffer.from(JSON.stringify(p), 'utf8').toString('base64')

/**
 * Signature scheme (verified by the control plane with the customer service key, issuer = NUXT_CUSTOMER_COMMERCIAL_ISSUER):
 *   signServiceRequest({ method, path: '/v1/customer/...?query', actor: <odoo user id>, issuer, key,
 *                        body: `liwan-principal:${x-liwan-principal}\n${rawBody ?? ''}` })
 * i.e. the principal header value is covered by the body hash. Verifier recomputes that exact body string.
 */
export function signedBodyFor(principalHeader: string, rawBody: string | undefined, clientAddress?: string): string {
  return `liwan-principal:${principalHeader}\n${clientAddress ? `liwan-client:${clientAddress}\n` : ''}${rawBody ?? ''}`
}

export function signCustomerForward(input: { method: string; path: string; rawBody?: string; clientAddress?: string; principal: CustomerPrincipal; issuer: string; key: string; timestamp?: number; nonce?: string }) {
  const principalHeader = encodePrincipal(input.principal)
  const signed = signServiceRequest({ method: input.method, path: input.path, body: signedBodyFor(principalHeader, input.rawBody, input.clientAddress), actor: input.principal.actor_id, issuer: input.issuer, key: input.key, timestamp: input.timestamp, nonce: input.nonce })
  return { ...signed, 'x-liwan-principal': principalHeader }
}

/** The tenant this request is bound to: the verified host binding in shared mode, the configured id in dedicated mode. */
function boundTenantId(tenant: ReturnType<typeof tenantRequest>, config: CustomerConfig): string | undefined {
  return tenant ? tenant.tenantId : config.customerCommercialTenantId
}

export async function customerPrincipal(event: H3Event, config: CustomerConfig, write = false): Promise<CustomerPrincipal> {
  const cookie = getHeader(event, 'cookie')
  if (!cookie) fail(401, 'unauthorized', 'A signed-in company session is required')
  const tenant = tenantRequest(event)
  const tenantId = boundTenantId(tenant, config)
  if (!tenantId) fail(503, 'commercial_unavailable', 'Tenant binding is not configured')
  let me: unknown
  try {
    if (tenant || process.env.LIWAN_RELEASE_ROUTES_DIR) {
      const response = await tenantTransport(event, config.odooUrl ?? '', '/api/v1/me')
      if (!response.ok) throw Object.assign(new Error('actor_unavailable'), { statusCode: response.status })
      me = await response.json()
    } else me = await $fetch(`${config.odooUrl}/api/v1/me`, { headers: { cookie }, redirect: 'error', signal: AbortSignal.timeout(5000) })
  } catch (cause: unknown) {
    const error = cause as { statusCode?: number; response?: { status?: number } }
    const status = Number(error?.statusCode ?? error?.response?.status)
    if (status === 401 || status === 403) fail(401, 'unauthorized', 'The company session is not valid')
    fail(503, 'commercial_unavailable', 'The company session could not be verified temporarily')
  }
  const parsed = MeSchema.safeParse(me)
  if (!parsed.success) fail(401, 'unauthorized', 'The company session is not valid')
  if (write && parsed.data.read_only) fail(403, 'user_read_only', 'This account has read-only access')
  return { actor_id: String(parsed.data.id), kind: 'customer', tenant_id: String(tenantId), capabilities: deriveCustomerCapabilities(parsed.data.capabilities) }
}

export async function forwardCustomerRequest(event: H3Event): Promise<unknown> {
  const config = useRuntimeConfig(event) as CustomerConfig
  if (!customerCommercialEnabled(config)) fail(404, 'not_found', 'Not found')
  const method = getMethod(event).toUpperCase()
  const incoming = getRequestURL(event)
  const rest = incoming.pathname.replace(/^\/api\/commercial\/v1\/?/, '')
  const route = customerRoute(method, rest)
  if (!route) fail(404, 'not_found', 'Not found')
  const isMutation = method !== 'GET'
  if (!config.customerCommercialServiceKey || config.customerCommercialServiceKey.length < 32 || !config.customerCommercialIssuer) fail(503, 'commercial_unavailable', 'Subscription service is not configured')
  assertNoForgedFields(Object.fromEntries(incoming.searchParams))
  if (isMutation) assertCustomerMutationOrigin(event, config)
  else ensureCsrfCookie(event)

  const write = isMutation && route.upstream !== '/v1/customer/preview'
  const principal = await customerPrincipal(event, config, write)
  if (!principal.capabilities.includes(route.needs)) fail(403, 'forbidden', 'You do not have access to this subscription action')

  let rawBody: string | undefined
  if (isMutation) {
    rawBody = (await withTenantBody(event, 'session', () => boundedTenantBody(event, 64 * 1024)))?.toString('utf8')
    if (!rawBody || Buffer.byteLength(rawBody) > 64 * 1024) fail(rawBody ? 413 : 400, rawBody ? 'payload_too_large' : 'invalid_json', rawBody ? 'Request body is too large' : 'A JSON object body is required')
    let body: unknown
    try { body = JSON.parse(rawBody) } catch { fail(400, 'invalid_json', 'A valid JSON object body is required') }
    if (body === null || typeof body !== 'object' || Array.isArray(body)) fail(400, 'invalid_json', 'A JSON object body is required')
    assertNoForgedFields(body)
    if (!rateLimitMutation(`${principal.tenant_id}:${principal.actor_id}:${getCookie(event, 'session_id') ?? getCookie(event, CSRF_COOKIE) ?? ''}`)) fail(429, 'rate_limited', 'Too many requests, try again shortly')
  }
  const target = new URL(route.upstream + incoming.search, customerControlBase(config))
  // The deletion routes record the edge-observed client address as a fact, so it is signed with the request; no other route forwards it.
  const edgeAddress = getHeader(event, 'x-liwan-client-ip')
  const clientAddress = route.upstream.startsWith('/v1/customer/deletion/') && edgeAddress && isIP(edgeAddress) ? edgeAddress : undefined
  const headers = { ...(clientAddress ? { 'x-liwan-client-ip': clientAddress } : {}), ...signCustomerForward({ method, path: `${target.pathname}${target.search}`, rawBody, clientAddress, principal, issuer: config.customerCommercialIssuer, key: config.customerCommercialServiceKey }), 'content-type': 'application/json', accept: 'application/json' }
  try {
    const response = await $fetch.raw(target.toString(), { method: method as any, body: rawBody, headers, redirect: 'error', signal: AbortSignal.timeout(10000) })
    setResponseStatus(event, response.status)
    setResponseHeader(event, 'cache-control', 'no-store')
    return response._data
  } catch (cause: any) {
    const status = Number(cause?.statusCode ?? cause?.response?.status)
    if (status >= 400 && status < 500) {
      // Preserve the control plane's refusal code: the customer UI must explain an
      // unavailable tenant upgrade instead of calling every 409 a subscription conflict.
      const data = cause?.data ?? cause?.response?._data
      throw createError({ statusCode: status, data: data ?? { code: 'commercial_request_failed', message: 'Request failed' } })
    }
    fail(503, 'commercial_unavailable', 'Subscription service is temporarily unavailable')
  }
}

/** Relays only this prospect's anonymous signup operation, with the edge-derived address signed in the body. */
export async function forwardSignupRequest(event: H3Event): Promise<unknown> {
  const config = useRuntimeConfig(event) as CustomerConfig
  const incoming = getRequestURL(event)
  const action = SIGNUP_API.exec(incoming.pathname)?.[1]
  if (!action || incoming.search || !isProspectRequest({
    host: getHeader(event, 'host'), proxyToken: getHeader(event, 'x-liwan-proxy-token'), pathname: incoming.pathname,
  }, config)) fail(404, 'not_found', 'Not found')
  const origin = new URL(config.customerCommercialPublicOrigin!).origin
  if (getHeader(event, 'origin') !== origin) fail(403, 'forbidden', 'Origin denied')
  const type = getHeader(event, 'content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (type !== 'application/json') fail(415, 'invalid', 'JSON is required')
  const ip = getHeader(event, 'x-liwan-signup-client')
  const key = config.customerCommercialServiceKey
  const issuer = config.customerCommercialIssuer
  if (!ip || !isIP(ip) || !key || key.length < 32 || !issuer) fail(503, 'unavailable', 'Signup is unavailable')

  const raw = await withTenantBody(event, 'public', () => boundedTenantBody(event, 4096))
  const body = raw?.toString('utf8')
  if (!body) fail(422, 'invalid', 'JSON is required')
  const target = new URL(`/v1/customer/signup/${action}`, customerControlBase(config))
  const signed = signServiceRequest({
    method: 'POST', path: target.pathname, body: `liwan-signup:${ip}\n${body}`, actor: 'anonymous', anonymous: true, issuer, key,
  })
  setResponseHeader(event, 'cache-control', 'no-store')
  let response
  try {
    response = await $fetch.raw<{ code?: string }>(target.toString(), {
      method: 'POST', body, headers: { ...signed, 'x-liwan-signup-client': ip, 'content-type': 'application/json' },
      redirect: 'error', signal: AbortSignal.timeout(12_000), retry: 0, ignoreResponseError: true,
    })
  } catch { fail(503, 'unavailable', 'Signup is unavailable') }
  if (!response.ok) {
    const code = response._data?.code
    if (code && ['invalid', 'invalid_code', 'rate_limited', 'trial_already_used', 'signup_expired', 'business_email_required', 'terms_not_accepted', 'terms_changed', 'human_check_failed', 'human_check_unavailable'].includes(code)) {
      fail(response.status, code, 'Signup request rejected')
    }
    fail(503, 'unavailable', 'Signup is unavailable')
  }
  setResponseStatus(event, response.status)
  return response._data
}

const LOOKUP_BODY_LIMIT = 4096
const LOOKUP_REFUSALS = ['invalid', 'rate_limited', 'human_check_failed', 'human_check_unavailable']

/** Strips every field except the typed address and the human-check token; null unless both are bounded non-empty strings. */
export function pickWorkspaceLookupBody(body: unknown): { email: string; human_token: string } | null {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return null
  const { email, human_token } = body as Record<string, unknown>
  if (typeof email !== 'string' || typeof human_token !== 'string') return null
  const trimmed = email.trim()
  if (trimmed.length < 3 || trimmed.length > 254 || !human_token || human_token.length > 2048) return null
  return { email: trimmed, human_token }
}

/** Relays the anonymous "find my workspace" request from the LiwanOS public host. The common host has no tenant, so the trust path is
 * the sign-up relay's: the prospect-host check with the shared proxy token, the same-origin check, and the edge-derived visitor address
 * signed together with the body. The answer is {ok:true} whether or not the address manages a workspace; the control plane decides later. */
export async function forwardWorkspaceLookup(event: H3Event): Promise<unknown> {
  const config = useRuntimeConfig(event) as CustomerConfig
  const incoming = getRequestURL(event)
  if (incoming.search || !FIND_WORKSPACE_API.test(incoming.pathname) || !isProspectRequest({
    host: getHeader(event, 'host'), proxyToken: getHeader(event, 'x-liwan-proxy-token'), pathname: incoming.pathname,
  }, config)) fail(404, 'not_found', 'Not found')
  setResponseHeader(event, 'cache-control', 'no-store')
  if (getHeader(event, 'origin') !== new URL(config.customerCommercialPublicOrigin!).origin) fail(403, 'forbidden', 'Origin denied')
  const type = getHeader(event, 'content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (type !== 'application/json') fail(415, 'invalid', 'JSON is required')
  const ip = getHeader(event, INVITATION_CLIENT_HEADER)
  const key = config.customerCommercialServiceKey
  const issuer = config.customerCommercialIssuer
  if (!ip || !isIP(ip) || !key || Buffer.byteLength(key) < MIN_SERVICE_KEY_LENGTH || !issuer) fail(503, 'unavailable', 'Service unavailable')
  const raw = await withTenantBody(event, 'public', () => boundedTenantBody(event, LOOKUP_BODY_LIMIT))
  let parsed: unknown
  try { parsed = JSON.parse(raw?.toString('utf8') ?? '') } catch { parsed = null }
  const picked = pickWorkspaceLookupBody(parsed)
  if (!picked) fail(400, 'invalid', 'Invalid request')
  const body = JSON.stringify(picked)
  const target = new URL('/v1/customer/find-workspace', customerControlBase(config))
  const signed = signServiceRequest({ method: 'POST', path: target.pathname, body: `liwan-find-workspace:${ip}\n${body}`, actor: 'anonymous', anonymous: true, issuer, key })
  let response
  try {
    response = await $fetch.raw<{ code?: string }>(target.toString(), {
      method: 'POST', body, headers: { ...signed, [INVITATION_CLIENT_HEADER]: ip, 'content-type': 'application/json', accept: 'application/json' },
      redirect: 'error', signal: AbortSignal.timeout(12_000), retry: 0, ignoreResponseError: true,
    })
  } catch { fail(503, 'unavailable', 'Service unavailable') }
  if (!response.ok) {
    const code = response._data?.code
    if (code && LOOKUP_REFUSALS.includes(code)) fail(response.status, code, 'Request rejected')
    fail(503, 'unavailable', 'Service unavailable')
  }
  setResponseStatus(event, 202)
  return { ok: true }
}

/** The dedicated edge sets this from the socket peer (deploy/Caddyfile, deploy/releases/Caddyfile.dedicated); the shared
 * guard strips it. The control plane reads the same name, with the signature, to key its invitation rate limit. */
export const INVITATION_CLIENT_HEADER = 'x-liwan-client-ip'
const MIN_SERVICE_KEY_LENGTH = 32

/** Signed claim of the visitor's address for one control-plane invitation call. Empty when the edge supplied no valid
 * address or the signing key is not configured, so the control plane falls back to the socket address as before. */
export function invitationClientHeaders(event: H3Event, config: Pick<CustomerConfig, 'customerCommercialIssuer' | 'customerCommercialServiceKey'>, target: URL): Record<string, string> {
  const ip = getHeader(event, INVITATION_CLIENT_HEADER)
  const { customerCommercialIssuer: issuer, customerCommercialServiceKey: key } = config
  if (!ip || !isIP(ip) || !issuer || !key || Buffer.byteLength(key) < MIN_SERVICE_KEY_LENGTH) return {}
  const signed = signServiceRequest({ method: 'POST', path: target.pathname, body: `liwan-invitation-client:${ip}\n`, actor: 'anonymous', anonymous: true, issuer, key })
  return { ...signed, [INVITATION_CLIENT_HEADER]: ip }
}

/** Signed headers for the public "send me a new invitation" call: the tenant this host is bound to and the visitor's address under one
 * signature (domain-separated from the client-address one). The tenant comes from the host binding, never from the browser;
 * the address comes from the edge (deploy/shared/Caddyfile, the dedicated edge). */
export function invitationReissueHeaders(event: H3Event, config: CustomerConfig, target: URL): Record<string, string> {
  const tenantId = boundTenantId(tenantRequest(event), config)
  const { customerCommercialIssuer: issuer, customerCommercialServiceKey: key } = config
  if (!tenantId || !issuer || !key || Buffer.byteLength(key) < MIN_SERVICE_KEY_LENGTH) fail(503, 'unavailable', 'Service unavailable')
  // The control plane budgets this route per visitor and refuses it without a signed address, so a missing one stops here too.
  const ip = getHeader(event, INVITATION_CLIENT_HEADER)
  if (!ip || !isIP(ip)) fail(503, 'unavailable', 'Service unavailable')
  const signed = signServiceRequest({ method: 'POST', path: target.pathname, body: `liwan-invitation-reissue:${tenantId}\n${ip}\n`, actor: 'anonymous', anonymous: true, issuer, key })
  return { ...signed, 'x-liwan-tenant': tenantId, [INVITATION_CLIENT_HEADER]: ip }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PAYMENT_RETURN_BODY = (tenantId: string) => `liwan-payment-return:${tenantId}\n`

type PaymentReturn = { orderId: string; paymentState: string }

/** What a provider payment id looks like (the control plane's own check): an opaque id, never a place for anything else. */
const PAYMENT_HINT = /^[A-Za-z0-9_-]{8,100}$/

/** Asks the control plane to verify one attempt with the provider; resolves its order, or null on any failure. `payment` is the provider's payment id from the return, a hint to fetch and never proof. */
async function verifyPaymentReturn(event: H3Event, config: CustomerConfig, attempt: string, payment: string | null, prospect: boolean): Promise<PaymentReturn | null> {
  try {
    if (!config.customerCommercialServiceKey || !config.customerCommercialIssuer) return null
    const tenantId = prospect ? PROSPECT_TENANT : boundTenantId(tenantRequest(event), config)
    if (!tenantId) return null
    if (!allowPaymentReturn(`${tenantId}|${paymentReturnClient(event)}`, `${tenantId}|${attempt}`)) { console.warn('[payment-return] rate limited'); return null }
    const target = new URL(`/v1/customer/payment-returns/${attempt}`, customerControlBase(config))
    if (payment) target.searchParams.set('payment', payment)
    // Anonymous signature: the return carries no user, so it proves only that this web server asked.
    const signed = signServiceRequest({ method: 'POST', path: `${target.pathname}${target.search}`, body: PAYMENT_RETURN_BODY(tenantId), actor: 'anonymous', anonymous: true, issuer: config.customerCommercialIssuer, key: config.customerCommercialServiceKey })
    const response = await $fetch.raw(target.toString(), { method: 'POST', headers: { ...signed, 'x-liwan-tenant': tenantId, accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(8000) })
    const data = response._data as { order_id?: unknown; payment_state?: unknown } | null
    return typeof data?.order_id === 'string' && UUID.test(data.order_id) ? { orderId: data.order_id, paymentState: typeof data.payment_state === 'string' ? data.payment_state : '' } : null
  } catch (cause: any) {
    // Never the attempt id: it is the only secret-like value this route handles.
    const status = Number(cause?.statusCode ?? cause?.response?.status)
    console.warn(`[payment-return] lookup failed: ${status ? `http ${status}` : (cause?.name ?? 'error')}`)
    return null
  }
}

/** Where a prospect (a customer with no workspace yet) lands: it has no session, so no page behind a sign-in. */
export function prospectLanding(result: PaymentReturn | null): string {
  if (!result) return '/payment-done'
  if (['paid', 'not_required'].includes(result.paymentState)) return '/payment-done?result=paid'
  return ['refund_pending', 'refunded'].includes(result.paymentState) ? '/payment-done?result=failed' : '/payment-done'
}

/**
 * Payment return endpoint, reached by the customer's browser (GET) or the provider's notification (POST).
 * Neither is trusted: only the attempt id is read, no body, no cookie, no CSRF. It triggers a provider
 * lookup in the control plane and shows its result; the reconciler settles whatever this misses.
 */
export async function relayPaymentReturn(event: H3Event): Promise<string> {
  const config = useRuntimeConfig(event) as CustomerConfig
  if (!customerCommercialEnabled(config)) fail(404, 'not_found', 'Not found')
  const method = getMethod(event).toUpperCase()
  setResponseHeader(event, 'cache-control', 'no-store')
  // The return URL carries the attempt's secret (`k`): nothing it leads to may learn it from a Referer.
  setResponseHeader(event, 'referrer-policy', 'no-referrer')
  if (method !== 'GET' && method !== 'POST') { setResponseStatus(event, 405); setResponseHeader(event, 'allow', 'GET, POST'); return '' }
  const url = getRequestURL(event)
  const prospect = isProspectRequest({ host: getHeader(event, 'host'), proxyToken: getHeader(event, 'x-liwan-proxy-token'), pathname: url.pathname }, config)
  const attempt = url.searchParams.get('attempt') ?? ''
  // `k` (the callback secret the provider holds) is never read here: the control plane compares the provider's copy with its own. `id` is only a hint.
  const hint = url.searchParams.get('id')
  const result = UUID.test(attempt) ? await verifyPaymentReturn(event, config, attempt, hint && PAYMENT_HINT.test(hint) ? hint : null, prospect) : null
  if (method === 'POST') { setResponseStatus(event, 204); return '' }
  setResponseStatus(event, 303)
  setResponseHeader(event, 'location', prospect ? prospectLanding(result) : result ? `/subscription/status?order=${result.orderId}` : '/subscription')
  return ''
}
