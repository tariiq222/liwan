import { joinURL } from 'ufo'

// SSR and browser calls to /api/v1/** both land here. The target is read from
// runtime config per request, so the container's NUXT_ODOO_URL applies at boot
// rather than whatever host the image happened to be built on.
export default defineEventHandler((event) => {
  const { odooUrl } = useRuntimeConfig(event)
  return proxyRequest(event, joinURL(odooUrl, event.path))
})
