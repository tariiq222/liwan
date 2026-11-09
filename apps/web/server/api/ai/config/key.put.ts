import { AiKeyPutSchema } from '@liwan/contracts'
import { boundedTenantJson } from '../../../utils/tenantTransport'
import { invalidBody, tenantConfig } from '../../../utils/ai/config'

// The field is named, never the value: the body holds the tenant's key.
// A provider, a model, a key of at most 512 characters and a base URL of at most 512: 8 KiB, refused with a 413 before
// it is parsed (issue #479).
const MAX_BODY = 8 * 1024

export default defineEventHandler(async (event) => {
  assertSameSiteJson(event)
  const parsed = AiKeyPutSchema.safeParse(await boundedTenantJson<Record<string, unknown>>(event, MAX_BODY))
  if (!parsed.success) throw invalidBody(String(parsed.error.issues[0]?.path[0] ?? 'body'))
  return tenantConfig(event, 'PUT', '/v1/tenant/config/key', parsed.data)
})
