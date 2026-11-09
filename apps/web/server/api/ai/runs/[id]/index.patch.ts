import { getRouterParam } from 'h3'
import { AiRunPatchSchema, AiRunSummarySchema } from '@liwan/contracts'
import { serviceFetch } from '../../../../utils/ai/upstream'
import { runSession } from '../../../../utils/ai/session'
import { restoreValue } from '../../../../utils/ai/outbound'
import { boundedTenantJson } from '../../../../utils/tenantTransport'

// A rename is a title of at most 80 characters and an archive flag: 4 KiB, refused with a 413 before it is parsed (issue #479).
const MAX_BODY = 4 * 1024

export default defineEventHandler(async (event) => {
  assertSameSiteJson(event)
  const id = getRouterParam(event, 'id') ?? event.context.params?.id
  if (!id) throw createError({ statusCode: 404, data: { code: 'not_found', message: 'run not found' } })
  const parsed = AiRunPatchSchema.safeParse(await boundedTenantJson<Record<string, unknown>>(event, MAX_BODY))
  if (!parsed.success) throw createError({ statusCode: 422, data: { code: 'invalid', message: 'invalid request', field: String(parsed.error.issues[0]?.path[0] ?? 'body') } })
  const session = await runSession(event)
  // A title the user types is stored by the service and never reaches a provider, so it is sent as typed; the response is
  // restored because a title the model wrote can carry tokens.
  const response = await serviceFetch(event, 'PATCH', `/v1/runs/${encodeURIComponent(id)}`, session.owner, parsed.data)
  if (response.status === 404) throw createError({ statusCode: 404, data: { code: 'not_found', message: 'run not found' } })
  if (!response.ok) throw createError({ statusCode: 502, data: { code: 'ai_upstream', message: `AI service status ${response.status}` } })
  return restoreValue(AiRunSummarySchema.parse(await response.json()), session.tokenKey)
})
