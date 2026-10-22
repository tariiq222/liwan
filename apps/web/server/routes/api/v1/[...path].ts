import { getProxyRequestHeaders, sendProxy, sendWebResponse } from 'h3'
import { boundedTenantBody, tenantTransport, withUpstreamSlot } from '../../../utils/tenantTransport'
import { joinURL } from 'ufo'
import { tenantUpstreamHeaders } from '../../../utils/tenantRequest'
import { requireApiSession } from '../../../utils/apiSessionAdmission'

// The only /api/v1 routes Odoo serves with auth='public': login-page branding
// and the MFA confirmation. Everything else requires a session cookie.
const PUBLIC_API_PATHS = new Set(['/api/v1/branding', '/api/v1/auth/totp'])

// SSR and browser calls to /api/v1/** both land here. The target is read from
// runtime config per request, so the container's NUXT_ODOO_URL applies at boot
// rather than whatever host the image happened to be built on.
export default defineEventHandler(async (event) => {
  const { odooUrl } = useRuntimeConfig(event)
  const headers = tenantUpstreamHeaders(event)
  const url = joinURL(odooUrl, event.path)
  const apiPath = event.path.split('?')[0] ?? event.path
  if (!PUBLIC_API_PATHS.has(apiPath)) await requireApiSession(event, odooUrl, headers)
  // Buffer uploads with a size/deadline bound before taking a work slot. This
  // also covers public MFA confirmation: a slow anonymous body cannot hold it.
  const body = await boundedTenantBody(event)
  return Object.keys(headers).length
    ? sendWebResponse(event, await tenantTransport(event, odooUrl, event.path, { method: event.method, body }))
    : withUpstreamSlot(signal => sendProxy(event, url, {
        fetchOptions: { method: event.method, body, headers: getProxyRequestHeaders(event, { host: false }), signal },
      }), event)
})
