import { createError, getHeader, sendWebResponse } from 'h3'
import { boundedTenantBody, tenantTransport, withUpstreamSlot } from '../../../utils/tenantTransport'
import { joinURL } from 'ufo'
import { tenantUpstreamHeaders } from '../../../utils/tenantRequest'

// The only /api/v1 routes Odoo serves with auth='public': login-page branding
// and the MFA confirmation. Everything else requires a session cookie.
const PUBLIC_API_PATHS = new Set(['/api/v1/branding', '/api/v1/auth/totp'])

// SSR and browser calls to /api/v1/** both land here. The target is read from
// runtime config per request, so the container's NUXT_ODOO_URL applies at boot
// rather than whatever host the image happened to be built on.
export default defineEventHandler((event) => {
  const { odooUrl } = useRuntimeConfig(event)
  const headers = tenantUpstreamHeaders(event)
  const url = joinURL(odooUrl, event.path)
  // Requests without a session cookie are rejected before their body is read
  // or an upstream slot is held, so the queue cannot be filled anonymously.
  const apiPath = event.path.split('?')[0] ?? event.path
  if (!PUBLIC_API_PATHS.has(apiPath) && !getHeader(event, 'cookie')?.includes('session_id=')) {
    throw createError({ statusCode: 403, data: { code: 'session_required' } })
  }
  // Dedicated preserves h3 proxying and cancels it when its client disconnects. Invalid/shared
  // requests still go through tenantUpstreamHeaders validation before forwarding.
  // Only the proxyRequest branch holds an upstream slot here: the
  // tenantTransport branch already gates inside tenantTransport, and holding a
  // second slot for the same request would starve the login path under pressure.
  return Object.keys(headers).length
    ? boundedTenantBody(event).then(body => tenantTransport(event, odooUrl, event.path, { method: event.method, body })).then(response => sendWebResponse(event, response))
    : withUpstreamSlot(signal => proxyRequest(event, url, { fetchOptions: { signal } }), event)
})
