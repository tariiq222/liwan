import { releaseProbeRequest } from '../utils/releaseReadiness'
import { tenantRequest } from '../utils/tenantRequest'
import { installReleaseContext } from '../utils/releaseRequest'

// Applies to SSR as well as BFF routes; direct network access must still be denied.
export default defineEventHandler((event) => {
  // Build-owned translation dictionaries contain public UI strings only. This
  // also lets Nitro prerender the hashed files into the immutable release store.
  if (['GET', 'HEAD'].includes(event.method) && /^\/_i18n\/[a-f0-9]{8,64}\/(?:ar|en)\/messages\.json$/.test(event.path)) return
  if (releaseProbeRequest(event)) return
  event.context.tenant = tenantRequest(event)
  installReleaseContext(event)
})
