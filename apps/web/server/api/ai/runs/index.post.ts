import { randomBytes } from 'node:crypto'
import { createEventStream, getCookie } from 'h3'
import { AiStartRequestSchema } from '@liwan/contracts'
import { audit, relay } from '../../../utils/ai/pump'
import { serviceFetch } from '../../../utils/ai/upstream'
import { runLocale } from '../../../utils/ai/runLocale'
import { runSession } from '../../../utils/ai/session'

export default defineEventHandler(async (event) => {
  assertSameSiteJson(event)
  const parsed = AiStartRequestSchema.safeParse(await readBody(event))
  if (!parsed.success) throw createError({ statusCode: 422, data: { code: 'invalid', message: 'invalid request', field: String(parsed.error.issues[0]?.path[0] ?? 'body') } })
  const { message, run_id: continued, context } = parsed.data
  const session = await runSession(event)
  // This server names a new run, so its first `message` audit already carries the run id and the message is still counted before the service is reached.
  const runId = continued ?? `r_${randomBytes(12).toString('hex')}`
  await audit(event, { conversation_id: runId, kind: 'message', tool_name: null, input: null, result: 'ok', http_status: null, draft: null, approved: null, attested: false })
  const locale = runLocale(getCookie(event, 'liwan-locale'))
  const response = await serviceFetch(event, 'POST', '/v1/runs', session.owner, {
    tenant: session.owner.tenant, user_ref: session.owner.user, locale, message,
    context: context ?? null, tools: session.tools, limits: session.limits, ...(continued ? { run_id: continued } : { new_run_id: runId }),
  })
  return relay(event, session, createEventStream(event), response, { runId })
})
