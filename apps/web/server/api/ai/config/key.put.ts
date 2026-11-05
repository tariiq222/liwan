import { AiKeyPutSchema } from '@liwan/contracts'
import { invalidBody, tenantConfig } from '../../../utils/ai/config'

export default defineEventHandler(async (event) => {
  assertSameSiteJson(event)
  const parsed = AiKeyPutSchema.safeParse(await readBody(event))
  // The field is named, never the value: the body holds the tenant's key.
  if (!parsed.success) throw invalidBody(String(parsed.error.issues[0]?.path[0] ?? 'body'))
  return tenantConfig(event, 'PUT', '/v1/tenant/config/key', parsed.data)
})
