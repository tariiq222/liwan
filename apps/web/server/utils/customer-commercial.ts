import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { isIP } from 'node:net'
import type { H3Event } from 'h3'
import { MeSchema } from '@webvue/contracts'
import { signServiceRequest } from '@webvue/commercial-contracts/server'
import { tenantRequest } from './tenantRequest'
import { tenantTransport } from './tenantTransport'
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

export const CSRF_COOKIE = 'webvue_csrf'
export const CSRF_HEADER = 'x-webvue-csrf'
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
  { method: 'POST', pattern: /^preview$/ },
  { method: 'POST', pattern: /^orders$/ },
  { method: 'GET', pattern: /^orders\/[A-Za-z0-9_-]{1,128}$/ },
  { method: 'POST', pattern: /^orders\/[A-Za-z0-9_-]{1,128}\/payment-attempts$/ },
  { method: 'GET', pattern: /^invoices$/ },
  { method: 'GET', pattern: /^invoices\/[A-Za-z0-9_-]{1,128}$/ },
  { method: 'GET', pattern: /^branches$/ },
  { method: 'POST', pattern: /^branch-quotes$/ },
  { method: 'GET', pattern: /^usage$/ },
  { method: 'POST', pattern: /^auto-renew$/ },
]
/** Capability each route needs (authoritative check also repeats in the control plane). */
const NEEDS: Array<[RegExp, string, CustomerCommercialCapability]> = [
  [/^quotes$|^orders|^auto-renew$|^trial(\/convert)?$/, 'POST', 'subscription.manage'],
  [/^preview$/, 'POST', 'subscription.read'],
  [/^branch-quotes$/, 'POST', 'branches.manage'],
  [/^invoices/, 'GET', 'billing.read'],
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
  const ip = getHeader(event, 'x-webvue-client-ip')
  return ip && isIP(ip) ? ip : 'unknown'
}

export const encodePrincipal = (p: CustomerPrincipal) => Buffer.from(JSON.stringify(p), 'utf8').toString('base64')

/**
 * Signature scheme (verified by the control plane with the customer service key, issuer = NUXT_CUSTOMER_COMMERCIAL_ISSUER):
 *   signServiceRequest({ method, path: '/v1/customer/...?query', actor: <odoo user id>, issuer, key,
 *                        body: `webvue-principal:${x-webvue-principal}\n${rawBody ?? ''}` })
 * i.e. the principal header value is covered by the body hash. Verifier recomputes that exact body string.
 */
export function signedBodyFor(principalHeader: string, rawBody: string | undefined): string {
  return `webvue-principal:${principalHeader}\n${rawBody ?? ''}`
}

export function signCustomerForward(input: { method: string; path: string; rawBody?: string; principal: CustomerPrincipal; issuer: string; key: string; timestamp?: number; nonce?: string }) {
  const principalHeader = encodePrincipal(input.principal)
  const signed = signServiceRequest({ method: input.method, path: input.path, body: signedBodyFor(principalHeader, input.rawBody), actor: input.principal.actor_id, issuer: input.issuer, key: input.key, timestamp: input.timestamp, nonce: input.nonce })
  return { ...signed, 'x-webvue-principal': principalHeader }
}

/** The tenant this request is bound to: the verified host binding in shared mode, the configured id in dedicated mode. */
function boundTenantId(tenant: ReturnType<typeof tenantRequest>, config: CustomerConfig): string | undefined {
  return tenant ? tenant.tenantId ?? (tenant as any).tenant_id ?? (tenant as any).id : config.customerCommercialTenantId
}

export async function customerPrincipal(event: H3Event, config: CustomerConfig): Promise<CustomerPrincipal> {
  const cookie = getHeader(event, 'cookie')
  if (!cookie) fail(401, 'unauthorized', 'A signed-in company session is required')
  const tenant = tenantRequest(event)
  const tenantId = boundTenantId(tenant, config)
  if (!tenantId) fail(503, 'commercial_unavailable', 'Tenant binding is not configured')
  let me: unknown
  try {
    if (tenant || process.env.WEBVUE_RELEASE_ROUTES_DIR) {
      const response = await tenantTransport(event, config.odooUrl ?? '', '/api/v1/me')
      if (!response.ok) throw new Error('actor_unavailable')
      me = await response.json()
    } else me = await $fetch(`${config.odooUrl}/api/v1/me`, { headers: { cookie }, redirect: 'error', signal: AbortSignal.timeout(5000) })
  } catch { fail(401, 'unauthorized', 'The company session is not valid') }
  const parsed = MeSchema.safeParse(me)
  if (!parsed.success) fail(401, 'unauthorized', 'The company session is not valid')
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

  const principal = await customerPrincipal(event, config)
  if (!principal.capabilities.includes(route.needs)) fail(403, 'forbidden', 'You do not have access to this subscription action')

  let rawBody: string | undefined
  if (isMutation) {
    if (Number(getHeader(event, 'content-length') ?? 0) > 64 * 1024) fail(413, 'payload_too_large', 'Request body is too large')
    rawBody = await readRawBody(event, 'utf8')
    if (!rawBody || Buffer.byteLength(rawBody) > 64 * 1024) fail(rawBody ? 413 : 400, rawBody ? 'payload_too_large' : 'invalid_json', rawBody ? 'Request body is too large' : 'A JSON object body is required')
    let body: unknown
    try { body = JSON.parse(rawBody) } catch { fail(400, 'invalid_json', 'A valid JSON object body is required') }
    if (body === null || typeof body !== 'object' || Array.isArray(body)) fail(400, 'invalid_json', 'A JSON object body is required')
    assertNoForgedFields(body)
    if (!rateLimitMutation(`${principal.tenant_id}:${principal.actor_id}:${getCookie(event, 'session_id') ?? getCookie(event, CSRF_COOKIE) ?? ''}`)) fail(429, 'rate_limited', 'Too many requests, try again shortly')
  }
  const target = new URL(route.upstream + incoming.search, customerControlBase(config))
  const headers = { ...signCustomerForward({ method, path: `${target.pathname}${target.search}`, rawBody, principal, issuer: config.customerCommercialIssuer, key: config.customerCommercialServiceKey }), 'content-type': 'application/json', accept: 'application/json' }
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PAYMENT_RETURN_BODY = (tenantId: string) => `webvue-payment-return:${tenantId}\n`

/** Asks the control plane to verify one attempt with the provider; resolves the order id, or null on any failure. */
async function verifyPaymentReturn(event: H3Event, config: CustomerConfig, attempt: string): Promise<string | null> {
  try {
    if (!config.customerCommercialServiceKey || !config.customerCommercialIssuer) return null
    const tenantId = boundTenantId(tenantRequest(event), config)
    if (!tenantId) return null
    if (!allowPaymentReturn(`${tenantId}|${paymentReturnClient(event)}`, `${tenantId}|${attempt}`)) { console.warn('[payment-return] rate limited'); return null }
    const target = new URL(`/v1/customer/payment-returns/${attempt}`, customerControlBase(config))
    // Anonymous signature: the return carries no user, so it proves only that this web server asked.
    const signed = signServiceRequest({ method: 'POST', path: target.pathname, body: PAYMENT_RETURN_BODY(tenantId), actor: 'anonymous', anonymous: true, issuer: config.customerCommercialIssuer, key: config.customerCommercialServiceKey })
    const response = await $fetch.raw(target.toString(), { method: 'POST', headers: { ...signed, 'x-webvue-tenant': tenantId, accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(8000) })
    const orderId = (response._data as { order_id?: unknown } | null)?.order_id
    return typeof orderId === 'string' && UUID.test(orderId) ? orderId : null
  } catch (cause: any) {
    // Never the attempt id: it is the only secret-like value this route handles.
    const status = Number(cause?.statusCode ?? cause?.response?.status)
    console.warn(`[payment-return] lookup failed: ${status ? `http ${status}` : (cause?.name ?? 'error')}`)
    return null
  }
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
  if (method !== 'GET' && method !== 'POST') { setResponseStatus(event, 405); setResponseHeader(event, 'allow', 'GET, POST'); return '' }
  const attempt = getRequestURL(event).searchParams.get('attempt') ?? ''
  const orderId = UUID.test(attempt) ? await verifyPaymentReturn(event, config, attempt) : null
  if (method === 'POST') { setResponseStatus(event, 204); return '' }
  setResponseStatus(event, 303)
  setResponseHeader(event, 'location', orderId ? `/subscription/status?order=${orderId}` : '/subscription')
  return ''
}
