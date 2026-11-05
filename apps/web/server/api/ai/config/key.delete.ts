import { tenantConfig } from '../../../utils/ai/config'

export default defineEventHandler((event) => {
  assertSameSiteJson(event)
  return tenantConfig(event, 'DELETE', '/v1/tenant/config/key')
})
