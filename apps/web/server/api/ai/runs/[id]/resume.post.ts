import { createEventStream, getRouterParam } from 'h3'
import { AiApprovedDraftSchema, AiRunStatusSchema } from '@liwan/contracts'
import { audit, auditFailedEvent, doneEvent, executeTool, needsApproval, relay, resumeFailedEvent, settle, tryAudit } from '../../../../utils/ai/pump'
import { logFailure, odooJson, serviceFetch } from '../../../../utils/ai/upstream'
import { assertRunnable, runPolicy } from '../../../../utils/ai/policy'
import { protectValue, restoreValue } from '../../../../utils/ai/outbound'
import { modeForAgent, ownerFor, runSession } from '../../../../utils/ai/session'
import type { ToolResult } from '../../../../utils/ai/executor'
import { boundedTenantJson } from '../../../../utils/tenantTransport'

type ResumeBody = { call_id?: string; decision?: 'approved' | 'rejected'; data?: Record<string, unknown> }

// A call id, a decision and the data a draft was approved with: 32 KiB, refused with a 413 before it is parsed (issue #479).
const MAX_BODY = 32 * 1024

const conflict = (message: string) => createError({ statusCode: 409, data: { code: 'conflict', message } })

/**
 * What an approved draft may carry: exactly `{id: <positive int>}`, the record the create page made (issue #556).
 * A shape the contract does not accept is a 422 before any audit row is written; whether the record exists, belongs to
 * this company and is readable here is Odoo's answer, so the check runs where the record rules are.
 */
function approvedData(data: Record<string, unknown> | undefined): { id: number } {
  const approved = AiApprovedDraftSchema.safeParse(data ?? {})
  if (!approved.success) throw createError({ statusCode: 422, data: { code: 'invalid', message: 'an approved draft carries only the id of the record it created', field: 'data' } })
  return approved.data
}

export default defineEventHandler(async (event) => {
  assertSameSiteJson(event)
  const id = getRouterParam(event, 'id') ?? event.context.params?.id
  const body = await boundedTenantJson<ResumeBody>(event, MAX_BODY)
  if (!id || !body?.call_id || (body.decision !== 'approved' && body.decision !== 'rejected')) throw createError({ statusCode: 422, data: { code: 'invalid', message: 'call_id and decision are required' } })
  // A decision carries data only when it approves a draft, and Odoo refuses an audit row it cannot verify (issue #556).
  if (body.data !== undefined && (body.decision !== 'approved' || body.data === null || typeof body.data !== 'object' || Array.isArray(body.data))) throw createError({ statusCode: 422, data: { code: 'invalid', message: 'data must be an object, sent with an approval', field: 'data' } })
  const path = `/v1/runs/${encodeURIComponent(id)}`
  const statusResponse = await serviceFetch(event, 'GET', path, await ownerFor(event))
  if (statusResponse.status === 404) throw createError({ statusCode: 404, data: { code: 'not_found', message: 'run not found' } })
  if (!statusResponse.ok) throw createError({ statusCode: 502, data: { code: 'ai_upstream', message: `AI service status ${statusResponse.status}` } })
  const { status, pending } = AiRunStatusSchema.parse(await statusResponse.json())
  // A claimed call is continued by the request that claimed it, never by another decision.
  if (status === 'executing') throw conflict('this run is executing a claimed call')
  // The pending call comes from the service, never from the browser: the browser only decides.
  if (!pending || pending.call_id !== body.call_id) throw conflict('no pending call with this call_id')
  // The pending call's agent names the conversation's mode.
  const session = await runSession(event, modeForAgent(pending.agent))
  // Before any tool runs: a write must not happen for a run the service will refuse to continue.
  await assertRunnable(event, session)

  let result: Record<string, unknown>
  let auditFailed = false
  // Once a write_light call is claimed it is executed and resumed whatever the browser does (signal `null` shields those calls).
  let shield: null | undefined
  let wroteAlready = false
  let toolResultEvent: { event: string; data: string } | null = null
  if (pending.kind === 'read' && body.decision === 'rejected') {
    // Only a read the administrator set to approval waits for the user; a stalled plain read can only be retried.
    if (!needsApproval(session, pending)) throw conflict('a read tool can only be retried')
    result = { ok: false, decision: 'rejected' }
  } else if (pending.kind === 'read') {
    // An approved read (its card, shown whenever the current catalog asks for approval), or a stalled one retried by the user.
    const executed = await executeTool(event, session, id, 'read', pending, { onAuditFailed: () => { auditFailed = true } })
    toolResultEvent = { event: 'tool_result', data: JSON.stringify({ call_id: pending.call_id, tool: pending.tool, kind: 'read', ok: executed.ok, summary_ar: pending.tool, summary_en: pending.tool }) }
    result = executed
  } else if (body.decision === 'rejected') {
    result = { ok: false, decision: 'rejected' }
    // Odoo accepts `rejected` for drafts only; a rejected write_light was never proposed to the audit.
    if (pending.kind === 'draft') {
      const draft = restoreValue(pending.input, session.tokenKey)
      auditFailed = !await tryAudit(event, { conversation_id: id, kind: 'draft', agent: pending.agent, tool_name: pending.tool, input: draft, result: 'rejected', http_status: null, draft, approved: null })
    }
  } else if (pending.kind === 'draft') {
    // A submitted draft is recorded here, never by the browser. The approval is recorded with the user's session: the call
    // and the draft come from the service, and Odoo verifies in the same transaction that the id the create page submitted
    // is a record this session may read, then stamps the time (issue #556). A client can therefore approve only a record it
    // really created and can see; anything else comes back 422 and the run is never resumed as an approval.
    const draft = restoreValue(pending.input, session.tokenKey)
    const approved = approvedData(body.data)
    result = { ok: true, decision: 'approved', data: approved }
    try {
      await audit(event, { conversation_id: id, kind: 'draft', agent: pending.agent, tool_name: pending.tool, input: draft, result: 'approved', http_status: 201, draft, approved })
    } catch (error) {
      // Odoo refused the approval itself (a forged or unreadable record): nothing was recorded, so this is the answer.
      if ((error as { statusCode?: number }).statusCode === 422) throw error
      // Anything else is bookkeeping: the record exists and the assistant still answers, with the fixed audit_failed event.
      logFailure('audit failed', error)
      auditFailed = true
    }
  } else if (pending.kind === 'write_light') {
    shield = null
    // The claim is atomic in the service: of two approvals only one is told to go on, the other gets 409 and executes nothing.
    const claim = await serviceFetch(event, 'POST', `${path}/claim`, session.owner, { call_id: body.call_id }, shield)
    if (claim.status === 409) throw conflict('this call was already claimed')
    if (!claim.ok) throw createError({ statusCode: 502, data: { code: 'ai_upstream', message: `AI service status ${claim.status}` } })
    wroteAlready = true
    let executed: ToolResult
    try {
      executed = await executeTool(event, session, id, 'write_light', pending, { signal: shield, onAuditFailed: () => { auditFailed = true } })
    } catch (error) {
      // executeTool does not throw; this keeps a claimed run from being stranded if that ever changes.
      logFailure('execute failed', error)
      executed = { ok: false, error: { code: 'upstream_unavailable', message: 'Odoo is unavailable' } }
    }
    result = { ...executed, decision: 'approved' }
  } else {
    result = { ok: true, decision: 'approved', data: body.data ?? {} }
  }
  let response: Response
  try {
    // A submitted draft leaves under the outbound data policy (spec 2026-11-04 §6.12); tool results were protected when built.
    response = await serviceFetch(event, 'POST', `${path}/resume`, session.owner, { call_id: body.call_id, result: protectValue(result, session.tokenKey), policy: runPolicy(session) }, shield)
    if (wroteAlready && !response.ok) throw new Error('the service refused the resume')
  } catch (error) {
    // The write already happened: the browser is told so (a 200 stream), not left to think nothing was done.
    if (!wroteAlready) throw error
    logFailure('resume after the write failed', error)
    return settle(createEventStream(event), [...(auditFailed ? [auditFailedEvent()] : []), resumeFailedEvent(), doneEvent('failed')])
  }
  return relay(event, session, createEventStream(event), response, { runId: id, auditFailed, shielded: wroteAlready, preface: toolResultEvent ?? undefined })
})
