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
// commercial/http.ts). Plain segments only: dots, percent escapes and backslashes can never match.
const ALLOWED = [
  new RegExp(`^/v1/(audit|catalog|context|operations|overview|packages|targets|tenants|commercial|shared/tenants)(/${SEGMENT})*$`),
  /^\/v1\/admin\/(me|accounts)$/,
  /^\/v1\/admin\/accounts\/[1-9][0-9]{0,15}\/(roles|disable|reset)$/,
]

/** Maps /api/vendor/v1/** to the control plane's /v1/**; anything outside the allowlist (the sign-in surface included) is 404. */
function upstreamPath(event: H3Event): string {
  const url = getRequestURL(event)
  if (!url.pathname.startsWith(BROWSER_PREFIX)) bffFail(404, 'not_found')
  const path = `/v1/${url.pathname.slice(BROWSER_PREFIX.length)}`
  if (!ALLOWED.some(pattern => pattern.test(path))) bffFail(404, 'not_found')
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
  const path = upstreamPath(event)
  const body = method === 'GET' ? undefined : (await readJsonObject(event, PROXY_INVALID)).raw
  const result = await controlCall(event, { path, method, body, session })
  if (result.status === 401) clearSession(event)
  return respond(event, result.status, result.data)
}
