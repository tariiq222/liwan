import { getQuery } from 'h3'
import { AiRunListQuerySchema, AiRunListSchema } from '@liwan/contracts'
import { serviceFetch } from '../../../utils/ai/upstream'
import { runSession } from '../../../utils/ai/session'
import { restoreValue } from '../../../utils/ai/outbound'

export default defineEventHandler(async (event) => {
  const query = AiRunListQuerySchema.safeParse(getQuery(event))
  if (!query.success) throw createError({ statusCode: 422, data: { code: 'invalid', message: 'invalid query', field: 'archived' } })
  const session = await runSession(event)
  const path = query.data.archived === 'true' ? '/v1/runs?archived=true' : '/v1/runs'
  const response = await serviceFetch(event, 'GET', path, session.owner)
  if (!response.ok) throw createError({ statusCode: 502, data: { code: 'ai_upstream', message: `AI service status ${response.status}` } })
  // A title the service made from a message may carry its tokens: the list shows the real values.
  return restoreValue(AiRunListSchema.parse(await response.json()), session.tokenKey)
})
