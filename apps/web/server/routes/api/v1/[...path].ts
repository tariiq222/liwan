import { sendWebResponse } from 'h3'
import { boundedTenantBody, tenantTransport, withUpstreamSlot } from '../../../utils/tenantTransport'
import { joinURL } from 'ufo'
import { tenantUpstreamHeaders } from '../../../utils/tenantRequest'

// SSR and browser calls to /api/v1/** both land here. The target is read from
// runtime config per request, so the container's NUXT_ODOO_URL applies at boot
// rather than whatever host the image happened to be built on.
export default defineEventHandler((event) => {
  const { odooUrl } = useRuntimeConfig(event)
  const headers = tenantUpstreamHeaders(event)
  const url = joinURL(odooUrl, event.path)
  // Dedicated keeps the original two-argument proxy contract. Invalid/shared
  // requests still go through tenantUpstreamHeaders validation before forwarding.
  // Both branches hold an upstream concurrency slot: overload queues here
  // instead of opening connections the kernel drops.
  return Object.keys(headers).length
    ? boundedTenantBody(event).then(body => withUpstreamSlot(() => tenantTransport(event, odooUrl, event.path, { method: event.method, body }))).then(response => sendWebResponse(event, response))
    : withUpstreamSlot(() => proxyRequest(event, url))
})
