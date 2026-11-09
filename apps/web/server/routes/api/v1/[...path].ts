import { createError, getHeader, getProxyRequestHeaders, sendWebResponse, setResponseHeader } from 'h3'
import { boundedTenantBody, tenantTransport, legacyTenantResponse, withTenantBody, withTenantResponse } from '../../../utils/tenantTransport'
import { uiLocaleHeaders, withUiLocale } from '../../../utils/uiLocale'
import { tenantUpstreamHeaders } from '../../../utils/tenantRequest'
import { requireApiSession } from '../../../utils/apiSessionAdmission'
import { canonicalApiPath } from '../../../utils/apiPath'
import { heavyRouteKind } from '../../../utils/heavyRoutes'
import { HEAVY_TIMEOUT } from '../../../utils/upstreamDeadlines'
import { forwardPublicApi, isBookingApiPath, isPublicApiPath, MAX_PUBLIC_API_BODY, PUBLIC_API_METHODS, PUBLIC_API_NAMESPACE_METHODS, PUBLIC_BODY_LIMITS } from '../../../utils/publicApi'

// Routes only this server may call (Nuxt writes them to Odoo directly, never through this proxy): a browser must not forge them.
// The provider usage ledger is one: its rows come from the AI service's own stream. The audit is the other: every row
// (a message, a tool call, a draft's proposal or approval) is written by this server, and an approval carries the
// acknowledgement the server stamps, so a client that could reach the route could count messages or claim an approval it
// never made (issue #556).
const SERVER_ONLY_API_PATHS = new Set(['/api/v1/ai/usage', '/api/v1/ai/audit'])

// SSR and browser calls to /api/v1/** both land here. The target is read from
// runtime config per request, so the container's NUXT_ODOO_URL applies at boot
// rather than whatever host the image happened to be built on.
export default defineEventHandler(async (event) => {
  const { odooUrl } = useRuntimeConfig(event)
  const headers = tenantUpstreamHeaders(event)
  // What is classified is exactly what Odoo receives: Odoo decodes escapes and ignores one trailing slash.
  const path = canonicalApiPath(event.path)
  const apiPath = path.split('?')[0] ?? path
  if (SERVER_ONLY_API_PATHS.has(apiPath)) throw createError({ statusCode: 404, data: { code: 'not_found', message: 'Not found' } })
  const publicNamespace = isPublicApiPath(apiPath)
  const publicMethods = PUBLIC_API_METHODS.get(apiPath) ?? (publicNamespace ? PUBLIC_API_NAMESPACE_METHODS : undefined)
  if (publicMethods && !publicMethods.includes(event.method)) {
    setResponseHeader(event, 'allow', publicMethods.join(', '))
    setResponseHeader(event, 'connection', 'close')
    throw createError({ statusCode: 405, data: { code: 'method_not_allowed', message: 'This endpoint does not support the request method.' } })
  }
  // Reuse only a plain GET /me owned by this cold request. Conditional/query/HEAD
  // requests still dispatch with their original semantics after admission.
  const reuseIdentity = event.method === 'GET' && path === '/api/v1/me' && !getHeader(event, 'if-none-match') && !getHeader(event, 'if-modified-since') && !getHeader(event, 'range')
  const identityHeaders: Record<string, string> | undefined = reuseIdentity ? (Object.keys(headers).length
    ? { cookie: getHeader(event, 'cookie') ?? '', ...uiLocaleHeaders(event) }
    : withUiLocale(event, getProxyRequestHeaders(event, { host: false }))) : undefined
  // A probe never receives browser hop-by-hop headers or a body length.
  if (identityHeaders) {
    const nominated = (identityHeaders.connection ?? '').toLowerCase().split(',').map(name => name.trim())
    for (const name of ['host', 'content-length', 'connection', 'keep-alive', 'proxy-connection', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', ...nominated]) delete identityHeaders[name]
  }
  const identity = !publicMethods ? await requireApiSession(event, odooUrl, headers, identityHeaders) : undefined
  if (identity) {
    // The tenant may have been disabled while the probe waited. Do not send even
    // its own response after the request's publication/revision boundary changed.
    return withTenantResponse(event, 'session', async () => {
      tenantUpstreamHeaders(event)
      return sendWebResponse(event, identity)
    })
  }
  // Body credits are separate from Odoo work slots and retained through dispatch.
  // Public routes skip session admission, so they draw on their own pool: the booking-link
  // routes on `booking`, the rest of the public surface on `public`, so neither can starve the
  // other nor sign-in.
  // Allowlisted heavy routes (never public) get their own pool, a longer deadline and, for writes, a write gate.
  const heavyKind = publicMethods ? null : heavyRouteKind(event.method, apiPath)
  const heavy = heavyKind ? { timeoutMs: HEAVY_TIMEOUT, write: heavyKind === 'write' } : undefined
  const scope = publicMethods ? (isBookingApiPath(apiPath) ? 'booking' : 'public') : heavy ? 'heavy' : 'session'
  return withTenantBody(event, scope, async () => {
    const body = await boundedTenantBody(event, PUBLIC_BODY_LIMITS.get(apiPath) ?? (publicNamespace ? MAX_PUBLIC_API_BODY : undefined))
    if (publicNamespace) return withTenantResponse(event, scope, async () => sendWebResponse(event, await forwardPublicApi(event, odooUrl, path, { method: event.method, body })))
    return withTenantResponse(event, scope, async () => Object.keys(headers).length
      ? sendWebResponse(event, await tenantTransport(event, odooUrl, path, { method: event.method, body, heavy }))
      : sendWebResponse(event, await legacyTenantResponse(event, odooUrl, path, { method: event.method, body, headers: withUiLocale(event, getProxyRequestHeaders(event, { host: false })), heavy })))
  })
})
