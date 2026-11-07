import { getMethod, getRequestURL, type H3Event } from 'h3'
import { PROXY_INVALID, readJsonObject } from './body'
import { controlCall, UPSTREAM_TIMEOUT_MS } from './control'
import { bffFail, respond } from './errors'
import { assertSameOrigin } from './origin'
import { clearSession, readSession } from './session-cookie'
import { bffConfig } from './config'

const METHODS = ['GET', 'POST', 'PATCH', 'DELETE']
const BROWSER_PREFIX = '/api/vendor/v1/'
const SEGMENT = '[A-Za-z0-9_-]+'

// The control-plane surface the vendor console uses (routes in apps/control-plane/src/http.ts and
// commercial/http.ts, commercial/routes-b.ts). Plain segments only: dots, percent escapes and backslashes can never match.
// Commercial routes are listed one by one: payment events, the payment simulator, renewals and
// the customer-facing /v1/customer/** surface are never reachable from the browser.
const ALLOWED = [
  new RegExp(`^/v1/(audit|catalog|context|operations|overview|targets|tenants|shared/tenants)(/${SEGMENT})*$`),
  new RegExp(`^/v1/commercial/(bundles|plans)(/${SEGMENT}(/(validate|publish|withdraw|restore|revisions))?)?$`),
  new RegExp(`^/v1/commercial/(customers|invoices|quotes)(/${SEGMENT})?$`),
  /^\/v1\/commercial\/(attention|catalog\/releases|clients|policies|customer-terms|customer-quotes|orders|analytics)$/,
  new RegExp(`^/v1/commercial/orders/${SEGMENT}/(cancel|payment-attempts)$`),
  new RegExp(`^/v1/commercial/catalog/releases/${SEGMENT}/default-bundles$`),
  new RegExp(`^/v1/commercial/invoice-adjustments/${SEGMENT}/refund$`),
  // Release 1 billing: the vendor-editable settings row, and recording a bank transfer against one invoice.
  /^\/v1\/commercial\/billing-settings$/,
  new RegExp(`^/v1/commercial/invoices/${SEGMENT}/bank-transfer$`),
  // A2: the customer-requested refund. Creates the pending vendor credit note; the provider reference is recorded
  // through the existing invoice-adjustments refund route above.
  new RegExp(`^/v1/commercial/invoices/${SEGMENT}/refund-request$`),
  new RegExp(`^/v1/commercial/customers/${SEGMENT}/(trial|invitations)$`),
  new RegExp(`^/v1/commercial/trials/${SEGMENT}/(extend|end)$`),
  // suspend and resume are separate actions the customer page offers; without them the console answered its own 404.
  new RegExp(`^/v1/commercial/subscriptions/${SEGMENT}(/(branches|usage|suspend|resume))?$`),
  /^\/v1\/platform\/ai-provider(\/(presets|models|test))?$/,
  /^\/v1\/admin\/(me|accounts)$/,
  /^\/v1\/admin\/accounts\/[1-9][0-9]{0,15}\/(roles|disable|reset)$/,
]
// The AI provider probes call a third party, and the control plane allows them 15 s (models) and two 20 s asks (test), apps/control-plane
// ai-provider/client.ts. The BFF must wait longer than that or it gives up with a 503 on a probe that is still running; the margin covers
// name resolution and the audit write. The other routes keep the default.
const SLOW_UPSTREAM = [
  { pattern: /^\/v1\/platform\/ai-provider\/models$/, timeoutMs: 30_000 },
  { pattern: /^\/v1\/platform\/ai-provider\/test$/, timeoutMs: 55_000 },
] as const

/** The upstream timeout for a control-plane path (query ignored). */
export function upstreamTimeoutMs(path: string): number {
  const pathname = path.split('?', 1)[0]!
  return SLOW_UPSTREAM.find(route => route.pattern.test(pathname))?.timeoutMs ?? UPSTREAM_TIMEOUT_MS
}

// Package revisions are read-only history (the control plane answers 410 to any write).
const READ_ONLY = [new RegExp(`^/v1/packages(/${SEGMENT})?$`)]
/** Routes whose method matters to the console: the allowlist is otherwise path-only. Each entry lists the methods the
 * console actually calls, so a stray DELETE cannot reach the control plane through a path that is only ever read. */
const METHOD_BOUND = [
  { pattern: /^\/v1\/commercial\/billing-settings$/, methods: ['GET', 'PATCH', 'POST'] },
  { pattern: new RegExp(`^/v1/commercial/invoices/${SEGMENT}/bank-transfer$`), methods: ['POST'] },
  { pattern: new RegExp(`^/v1/commercial/invoices/${SEGMENT}/refund-request$`), methods: ['POST'] },
] as const

/** Maps /api/vendor/v1/** to the control plane's /v1/**; anything outside the allowlist (the sign-in surface included) is 404. */
function upstreamPath(event: H3Event, method: string): string {
  const url = getRequestURL(event)
  if (!url.pathname.startsWith(BROWSER_PREFIX)) bffFail(404, 'not_found')
  const path = `/v1/${url.pathname.slice(BROWSER_PREFIX.length)}`
  const allowed = ALLOWED.some(pattern => pattern.test(path)) || (method === 'GET' && READ_ONLY.some(pattern => pattern.test(path)))
  if (!allowed) bffFail(404, 'not_found')
  const bound = METHOD_BOUND.find(route => route.pattern.test(path))
  if (bound && !(bound.methods as readonly string[]).includes(method)) bffFail(405, 'method_not_allowed')
  return `${path}${url.search}`
}

/** Signed pass-through of one browser API call, as the account named by the session cookie. */
export async function proxyVendorRequest(event: H3Event): Promise<unknown> {
  bffConfig(event)
  const method = getMethod(event).toUpperCase()
  if (!METHODS.includes(method)) bffFail(405, 'method_not_allowed')
  assertSameOrigin(event)
  const session = readSession(event)
  if (!session) return bffFail(401, 'unauthorized')
  const path = upstreamPath(event, method)
  const body = method === 'GET' ? undefined : (await readJsonObject(event, PROXY_INVALID)).raw
  const result = await controlCall(event, { path, method, body, session, timeoutMs: upstreamTimeoutMs(path) })
  if (result.status === 401) clearSession(event)
  return respond(event, result.status, result.data)
}
