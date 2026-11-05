import { AiLeaverRetentionPutSchema } from '@liwan/contracts'
import { invalidBody, tenantConfig } from '../../../utils/ai/config'

export default defineEventHandler(async (event) => {
  assertSameSiteJson(event)
  const parsed = AiLeaverRetentionPutSchema.safeParse(await readBody(event))
  if (!parsed.success) throw invalidBody(String(parsed.error.issues[0]?.path[0] ?? 'body'))
  return tenantConfig(event, 'PUT', '/v1/tenant/config/leaver-retention', parsed.data)
})
