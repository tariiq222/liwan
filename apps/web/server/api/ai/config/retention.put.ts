import { AiRetentionPutSchema } from '@liwan/contracts'
import { boundedTenantJson } from '../../../utils/tenantTransport'
import { invalidBody, tenantConfig } from '../../../utils/ai/config'

// A retention window is one bounded integer: 2 KiB, refused with a 413 before it is parsed (issue #479).
const MAX_BODY = 2 * 1024

export default defineEventHandler(async (event) => {
  assertSameSiteJson(event)
  const parsed = AiRetentionPutSchema.safeParse(await boundedTenantJson<Record<string, unknown>>(event, MAX_BODY))
  if (!parsed.success) throw invalidBody(String(parsed.error.issues[0]?.path[0] ?? 'body'))
  return tenantConfig(event, 'PUT', '/v1/tenant/config/retention', parsed.data)
})
