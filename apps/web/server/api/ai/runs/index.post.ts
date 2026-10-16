import { createEventStream, getCookie } from 'h3'
import { AiStartRequestSchema } from '@webvue/contracts'
import { audit, relay } from '../../../utils/ai/pump'
import { serviceFetch } from '../../../utils/ai/upstream'
import { runLocale } from '../../../utils/ai/runLocale'
import { runSession } from '../../../utils/ai/session'

export default defineEventHandler(async (event) => {
  assertSameSiteJson(event)
  const parsed = AiStartRequestSchema.safeParse(await readBody(event))
  if (!parsed.success) throw createError({ statusCode: 422, data: { code: 'invalid', message: 'invalid request', field: String(parsed.error.issues[0]?.path[0] ?? 'body') } })
  const { message, run_id: runId, context } = parsed.data
  const session = await runSession(event)
  // The message is counted first: a tenant over its monthly limit never reaches the service.
  // The service run id is not known yet, so a new run's first `message` audit carries the conversation id 'pending'; reordering to learn it first would let an over-limit tenant reach the service.
  await audit(event, { conversation_id: runId ?? 'pending', kind: 'message', tool_name: null, input: null, result: 'ok', http_status: null, draft: null, approved: null, attested: false })
  const locale = runLocale(getCookie(event, 'webvue-locale'))
  const response = await serviceFetch(event, 'POST', '/v1/runs', session.owner, {
    tenant: session.owner.tenant, user_ref: session.owner.user, locale, message,
    context: context ?? null, tools: session.tools, limits: session.limits, run_id: runId ?? null,
  })
  return relay(event, session, createEventStream(event), response)
})
