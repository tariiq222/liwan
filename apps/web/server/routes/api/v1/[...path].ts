import { createError, getProxyRequestHeaders, sendWebResponse, setResponseHeader } from 'h3'
import { boundedTenantBody, MAX_PUBLIC_MFA_BODY, tenantTransport, legacyTenantResponse, withTenantBody, withTenantResponse } from '../../../utils/tenantTransport'
import { tenantUpstreamHeaders } from '../../../utils/tenantRequest'
import { requireApiSession } from '../../../utils/apiSessionAdmission'
import { HEAVY_TIMEOUT, isHeavyRoute } from '../../../utils/heavyRoutes'

// The only /api/v1 routes Odoo serves with auth='public': login-page branding
// and the MFA confirmation. Everything else requires a session cookie.
const PUBLIC_API_METHODS = new Map<string, readonly string[]>([
  ['/api/v1/branding', ['GET', 'HEAD']],
  ['/api/v1/auth/totp', ['POST']],
])

// SSR and browser calls to /api/v1/** both land here. The target is read from
// runtime config per request, so the container's NUXT_ODOO_URL applies at boot
// rather than whatever host the image happened to be built on.
export default defineEventHandler(async (event) => {
  const { odooUrl } = useRuntimeConfig(event)
  const headers = tenantUpstreamHeaders(event)
  const apiPath = event.path.split('?')[0] ?? event.path
  const publicMethods = PUBLIC_API_METHODS.get(apiPath)
  if (publicMethods && !publicMethods.includes(event.method)) {
    setResponseHeader(event, 'allow', publicMethods.join(', '))
    setResponseHeader(event, 'connection', 'close')
    throw createError({ statusCode: 405, data: { code: 'method_not_allowed', message: 'This endpoint does not support the request method.' } })
  }
  if (!publicMethods) await requireApiSession(event, odooUrl, headers)
  // Body credits are separate from Odoo work slots and retained through dispatch.
  // Public routes skip session admission, so they draw on the separate public pool.
  // Allowlisted heavy routes (never public) get their own pool, upstream gate and longer deadline.
  const heavy = !publicMethods && isHeavyRoute(event.method, apiPath) ? { timeoutMs: HEAVY_TIMEOUT } : undefined
  const scope = publicMethods ? 'public' : heavy ? 'heavy' : 'session'
  return withTenantBody(event, scope, async () => {
    const body = await boundedTenantBody(event, apiPath === '/api/v1/auth/totp' ? MAX_PUBLIC_MFA_BODY : undefined)
    return withTenantResponse(event, scope, async () => Object.keys(headers).length
      ? sendWebResponse(event, await tenantTransport(event, odooUrl, event.path, { method: event.method, body, heavy }))
      : sendWebResponse(event, await legacyTenantResponse(event, odooUrl, event.path, { method: event.method, body, headers: getProxyRequestHeaders(event, { host: false }), heavy })))
  })
})
