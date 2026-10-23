import { createError, getProxyRequestHeaders, sendProxy, sendWebResponse, setResponseHeader } from 'h3'
import { boundedTenantBody, MAX_PUBLIC_MFA_BODY, tenantTransport, withUpstreamSlot } from '../../../utils/tenantTransport'
import { joinURL } from 'ufo'
import { tenantUpstreamHeaders } from '../../../utils/tenantRequest'
import { requireApiSession } from '../../../utils/apiSessionAdmission'

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
  const url = joinURL(odooUrl, event.path)
  const apiPath = event.path.split('?')[0] ?? event.path
  const publicMethods = PUBLIC_API_METHODS.get(apiPath)
  if (publicMethods && !publicMethods.includes(event.method)) {
    setResponseHeader(event, 'allow', publicMethods.join(', '))
    setResponseHeader(event, 'connection', 'close')
    throw createError({ statusCode: 405, data: { code: 'method_not_allowed', message: 'This endpoint does not support the request method.' } })
  }
  if (!publicMethods) await requireApiSession(event, odooUrl, headers)
  // Buffer uploads with a size/deadline bound before taking a work slot. This
  // also covers public MFA confirmation: a slow anonymous body cannot hold it.
  const body = await boundedTenantBody(event, apiPath === '/api/v1/auth/totp' ? MAX_PUBLIC_MFA_BODY : undefined)
  return Object.keys(headers).length
    ? sendWebResponse(event, await tenantTransport(event, odooUrl, event.path, { method: event.method, body }))
    : withUpstreamSlot(signal => sendProxy(event, url, {
        fetchOptions: { method: event.method, body: body ? new Uint8Array(body) : undefined, headers: getProxyRequestHeaders(event, { host: false }), signal },
      }), event)
})
