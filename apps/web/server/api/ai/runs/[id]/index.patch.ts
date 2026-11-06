import { getRouterParam } from 'h3'
import { AiRunPatchSchema, AiRunSummarySchema } from '@liwan/contracts'
import { serviceFetch } from '../../../../utils/ai/upstream'
import { runSession } from '../../../../utils/ai/session'
import { protectValue, restoreValue } from '../../../../utils/ai/outbound'

export default defineEventHandler(async (event) => {
  assertSameSiteJson(event)
  const id = getRouterParam(event, 'id') ?? event.context.params?.id
  if (!id) throw createError({ statusCode: 404, data: { code: 'not_found', message: 'run not found' } })
  const parsed = AiRunPatchSchema.safeParse(await readBody(event))
  if (!parsed.success) throw createError({ statusCode: 422, data: { code: 'invalid', message: 'invalid request', field: String(parsed.error.issues[0]?.path[0] ?? 'body') } })
  const session = await runSession(event)
  // A title the user types is stored by the service, so it leaves protected like a message.
  const response = await serviceFetch(event, 'PATCH', `/v1/runs/${encodeURIComponent(id)}`, session.owner, protectValue(parsed.data, session.tokenKey))
  if (response.status === 404) throw createError({ statusCode: 404, data: { code: 'not_found', message: 'run not found' } })
  if (!response.ok) throw createError({ statusCode: 502, data: { code: 'ai_upstream', message: `AI service status ${response.status}` } })
  return restoreValue(AiRunSummarySchema.parse(await response.json()), session.tokenKey)
})
