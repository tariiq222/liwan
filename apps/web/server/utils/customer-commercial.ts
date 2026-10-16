import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
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
  { method: 'POST', pattern: /^orders$/ },
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
  [/^quotes$|^orders|^auto-renew$/, 'POST', 'subscription.manage'],
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
export function resetRateLimitForTests() { buckets.clear() }

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

export async function customerPrincipal(event: H3Event, config: CustomerConfig): Promise<CustomerPrincipal> {
  const cookie = getHeader(event, 'cookie')
  if (!cookie) fail(401, 'unauthorized', 'A signed-in company session is required')
  const tenant = tenantRequest(event)
  const tenantId = tenant ? tenant.tenantId ?? (tenant as any).tenant_id ?? (tenant as any).id : config.customerCommercialTenantId
  if (!tenantId) fail(503, 'commercial_unavailable', 'Tenant binding is not configured')
  let me: unknown
  try {
    if (tenant) {
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
    if (status >= 400 && status < 500) throw createError({ statusCode: status, data: cause.data ?? { code: 'commercial_request_failed', message: 'Request failed' } })
    fail(503, 'commercial_unavailable', 'Subscription service is temporarily unavailable')
  }
}
