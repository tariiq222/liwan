import { getMethod, getRequestURL, type H3Event } from 'h3'
import { PROXY_INVALID, readJsonObject } from './body'
import { controlCall } from './control'
import { bffFail, respond } from './errors'
import { assertSameOrigin } from './origin'
import { clearSession, readSession } from './session-cookie'
import { bffConfig } from './config'

const METHODS = ['GET', 'POST', 'PATCH', 'DELETE']
const BROWSER_PREFIX = '/api/vendor'
const AUTH_PREFIX = '/v1/admin/auth/'

/** Maps /api/vendor/v1/** to the control plane's /v1/**; the sign-in surface is never reachable through here. */
function upstreamPath(event: H3Event): string {
  const url = getRequestURL(event)
  const path = url.pathname.slice(BROWSER_PREFIX.length)
  const resolved = new URL(`${path}${url.search}`, 'http://upstream.invalid')
  if (!resolved.pathname.startsWith('/v1/') || resolved.pathname.startsWith(AUTH_PREFIX) || resolved.pathname !== path) bffFail(404, 'not_found')
  return `${resolved.pathname}${resolved.search}`
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
