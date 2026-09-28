import { tenantRequest } from '../utils/tenantRequest'

// Applies to SSR as well as BFF routes; direct network access must still be denied.
export default defineEventHandler((event) => {
  event.context.tenant = tenantRequest(event)
})
