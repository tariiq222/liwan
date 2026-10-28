import { createError, getProxyRequestHeaders, sendWebResponse, setResponseHeader } from 'h3'
import { boundedTenantBody, MAX_PUBLIC_MFA_BODY, tenantTransport, legacyTenantResponse, withTenantBody, withTenantResponse } from '../../../utils/tenantTransport'
import { tenantUpstreamHeaders } from '../../../utils/tenantRequest'
import { requireApiSession } from '../../../utils/apiSessionAdmission'
import { canonicalApiPath } from '../../../utils/apiPath'
import { heavyRouteKind } from '../../../utils/heavyRoutes'
import { HEAVY_TIMEOUT } from '../../../utils/upstreamDeadlines'
import { forwardPublicApi, isPublicApiPath, MAX_PUBLIC_API_BODY, PUBLIC_API_NAMESPACE_METHODS } from '../../../utils/publicApi'

// Two auth='public' routes outside the public namespace, both part of the login flow: login-page
// branding and the MFA confirmation (which needs the pre-login session cookie). Everything under
// the public namespace is public too, without cookies; everything else requires a session cookie.
const PUBLIC_API_METHODS = new Map<string, readonly string[]>([
  ['/api/v1/branding', ['GET', 'HEAD']],
  ['/api/v1/auth/totp', ['POST']],
])

// Routes only this server may call (Nuxt writes them to Odoo directly, never through this proxy): a browser must not forge them.
// The provider usage ledger is one: its rows come from the AI service's own stream.
const SERVER_ONLY_API_PATHS = new Set(['/api/v1/ai/usage'])

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
  if (!publicMethods) await requireApiSession(event, odooUrl, headers)
  // Body credits are separate from Odoo work slots and retained through dispatch.
  // Public routes skip session admission, so they draw on the separate public pool.
  // Allowlisted heavy routes (never public) get their own pool, a longer deadline and, for writes, a write gate.
  const heavyKind = publicMethods ? null : heavyRouteKind(event.method, apiPath)
  const heavy = heavyKind ? { timeoutMs: HEAVY_TIMEOUT, write: heavyKind === 'write' } : undefined
  const scope = publicMethods ? 'public' : heavy ? 'heavy' : 'session'
  return withTenantBody(event, scope, async () => {
    const body = await boundedTenantBody(event, apiPath === '/api/v1/auth/totp' ? MAX_PUBLIC_MFA_BODY : publicNamespace ? MAX_PUBLIC_API_BODY : undefined)
    if (publicNamespace) return withTenantResponse(event, scope, async () => sendWebResponse(event, await forwardPublicApi(event, odooUrl, path, { method: event.method, body })))
    return withTenantResponse(event, scope, async () => Object.keys(headers).length
      ? sendWebResponse(event, await tenantTransport(event, odooUrl, path, { method: event.method, body, heavy }))
      : sendWebResponse(event, await legacyTenantResponse(event, odooUrl, path, { method: event.method, body, headers: getProxyRequestHeaders(event, { host: false }), heavy })))
  })
})
