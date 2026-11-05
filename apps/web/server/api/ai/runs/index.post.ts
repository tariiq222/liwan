import { randomBytes } from 'node:crypto'
import { createEventStream, getCookie } from 'h3'
import { AI_MESSAGE_MAX, AiStartRequestSchema } from '@liwan/contracts'
import { audit, relay } from '../../../utils/ai/pump'
import { serviceFetch } from '../../../utils/ai/upstream'
import { runLocale } from '../../../utils/ai/runLocale'
import { assertRunnable, runPolicy } from '../../../utils/ai/policy'
import { withholdText } from '../../../utils/ai/outbound'
import { conversationMode, runSession } from '../../../utils/ai/session'

export default defineEventHandler(async (event) => {
  assertSameSiteJson(event)
  const parsed = AiStartRequestSchema.safeParse(await readBody(event))
  if (!parsed.success) throw createError({ statusCode: 422, data: { code: 'invalid', message: 'invalid request', field: String(parsed.error.issues[0]?.path[0] ?? 'body') } })
  const { message, run_id: continued, context, mode } = parsed.data
  // A continued conversation keeps the mode it started in, whatever the browser sends (Odoo refuses a mismatch anyway).
  const started = continued ? await conversationMode(event, continued) : null
  const session = await runSession(event, started ?? (mode === 'setup' ? 'setup' : 'assistant'))
  await assertRunnable(event, session)
  // The outbound data policy (spec 2026-11-04 §6.12): the message leaves with identity, bank and contact values withheld.
  // A marker can be longer than the value it replaces, so the withheld message is measured before anything is counted.
  const outbound = withholdText(message)
  if (outbound.length > AI_MESSAGE_MAX) throw createError({ statusCode: 422, data: { code: 'invalid', message: 'the message is too long once sensitive values are withheld', field: 'message' } })
  // This server names a new run, so its first `message` audit already carries the run id and the message is still counted before the service is reached.
  const runId = continued ?? `r_${randomBytes(12).toString('hex')}`
  // A setup message spends the vendor's setup budget, never the package's messages.
  await audit(event, { conversation_id: runId, kind: session.mode === 'setup' ? 'setup' : 'message', tool_name: null, input: null, result: 'ok', http_status: null, draft: null, approved: null, attested: false })
  const locale = runLocale(getCookie(event, 'liwan-locale'))
  const response = await serviceFetch(event, 'POST', '/v1/runs', session.owner, {
    tenant: session.owner.tenant, user_ref: session.owner.user, locale, message: outbound,
    context: context ?? null, tools: session.tools, agents: session.agents, company: session.company, limits: session.limits, policy: runPolicy(session), ...(continued ? { run_id: continued } : { new_run_id: runId }),
  })
  return relay(event, session, createEventStream(event), response, { runId })
})
