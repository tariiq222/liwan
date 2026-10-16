import { getQuery } from 'h3'
import { AiRunListQuerySchema, AiRunListSchema } from '@webvue/contracts'
import { serviceFetch } from '../../../utils/ai/upstream'
import { runSession } from '../../../utils/ai/session'

export default defineEventHandler(async (event) => {
  const query = AiRunListQuerySchema.safeParse(getQuery(event))
  if (!query.success) throw createError({ statusCode: 422, data: { code: 'invalid', message: 'invalid query', field: 'archived' } })
  const session = await runSession(event)
  const path = query.data.archived === 'true' ? '/v1/runs?archived=true' : '/v1/runs'
  const response = await serviceFetch(event, 'GET', path, session.owner)
  if (!response.ok) throw createError({ statusCode: 502, data: { code: 'ai_upstream', message: `AI service status ${response.status}` } })
  return AiRunListSchema.parse(await response.json())
})
