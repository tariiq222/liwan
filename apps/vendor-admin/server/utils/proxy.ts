import { getMethod, getRequestURL, type H3Event } from 'h3'
import { PROXY_INVALID, readJsonObject } from './body'
import { controlCall } from './control'
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
  new RegExp(`^/v1/commercial/customers/${SEGMENT}/(trial|invitations)$`),
  new RegExp(`^/v1/commercial/trials/${SEGMENT}/(extend|end)$`),
  new RegExp(`^/v1/commercial/subscriptions/${SEGMENT}(/(branches|usage))?$`),
  /^\/v1\/admin\/(me|accounts)$/,
  /^\/v1\/admin\/accounts\/[1-9][0-9]{0,15}\/(roles|disable|reset)$/,
]
// Package revisions are read-only history (the control plane answers 410 to any write).
const READ_ONLY = [new RegExp(`^/v1/packages(/${SEGMENT})?$`)]

/** Maps /api/vendor/v1/** to the control plane's /v1/**; anything outside the allowlist (the sign-in surface included) is 404. */
function upstreamPath(event: H3Event, method: string): string {
  const url = getRequestURL(event)
  if (!url.pathname.startsWith(BROWSER_PREFIX)) bffFail(404, 'not_found')
  const path = `/v1/${url.pathname.slice(BROWSER_PREFIX.length)}`
  const allowed = ALLOWED.some(pattern => pattern.test(path)) || (method === 'GET' && READ_ONLY.some(pattern => pattern.test(path)))
  if (!allowed) bffFail(404, 'not_found')
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
  const result = await controlCall(event, { path, method, body, session })
  if (result.status === 401) clearSession(event)
  return respond(event, result.status, result.data)
}
