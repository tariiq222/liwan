import { getRouterParam } from 'h3'
import { AiRunStatusSchema } from '@liwan/contracts'
import { serviceFetch } from '../../../../utils/ai/upstream'
import { runSession } from '../../../../utils/ai/session'
import { needsApproval } from '../../../../utils/ai/pump'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? event.context.params?.id
  if (!id) throw createError({ statusCode: 404, data: { code: 'not_found', message: 'run not found' } })
  const session = await runSession(event)
  const response = await serviceFetch(event, 'GET', `/v1/runs/${encodeURIComponent(id)}`, session.owner)
  if (response.status === 404) throw createError({ statusCode: 404, data: { code: 'not_found', message: 'run not found' } })
  if (!response.ok) throw createError({ statusCode: 502, data: { code: 'ai_upstream', message: `AI service status ${response.status}` } })
  const run = AiRunStatusSchema.parse(await response.json())
  // A read the administrator set to approval after the run began is shown as a card to approve, never as a retry.
  if (run.pending?.kind === 'read' && needsApproval(session, run.pending)) run.pending = { ...run.pending, requires_approval: true }
  return run
})
