import { createEventStream, getRouterParam } from 'h3'
import { AiRunStatusSchema } from '@webvue/contracts'
import { auditFailedEvent, doneEvent, executeTool, relay, resumeFailedEvent, settle, tryAudit } from '../../../../utils/ai/pump'
import { logFailure, serviceFetch } from '../../../../utils/ai/upstream'
import { runSession } from '../../../../utils/ai/session'
import type { ToolResult } from '../../../../utils/ai/executor'

type ResumeBody = { call_id?: string; decision?: 'approved' | 'rejected'; data?: Record<string, unknown> }

const conflict = (message: string) => createError({ statusCode: 409, data: { code: 'conflict', message } })

export default defineEventHandler(async (event) => {
  assertSameSiteJson(event)
  const id = getRouterParam(event, 'id') ?? event.context.params?.id
  const body = await readBody<ResumeBody>(event)
  if (!id || !body?.call_id || (body.decision !== 'approved' && body.decision !== 'rejected')) throw createError({ statusCode: 422, data: { code: 'invalid', message: 'call_id and decision are required' } })
  if (body.data !== undefined && (body.data === null || typeof body.data !== 'object' || Array.isArray(body.data))) throw createError({ statusCode: 422, data: { code: 'invalid', message: 'data must be an object', field: 'data' } })
  const session = await runSession(event)
  const path = `/v1/runs/${encodeURIComponent(id)}`
  const statusResponse = await serviceFetch(event, 'GET', path, session.owner)
  if (statusResponse.status === 404) throw createError({ statusCode: 404, data: { code: 'not_found', message: 'run not found' } })
  if (!statusResponse.ok) throw createError({ statusCode: 502, data: { code: 'ai_upstream', message: `AI service status ${statusResponse.status}` } })
  const { status, pending } = AiRunStatusSchema.parse(await statusResponse.json())
  // A claimed call is continued by the request that claimed it, never by another decision.
  if (status === 'executing') throw conflict('this run is executing a claimed call')
  // The pending call comes from the service, never from the browser: the browser only decides.
  if (!pending || pending.call_id !== body.call_id) throw conflict('no pending call with this call_id')

  let result: Record<string, unknown>
  let auditFailed = false
  // Once a write_light call is claimed it is executed and resumed whatever the browser does (signal `null` shields those calls).
  let shield: null | undefined
  let wroteAlready = false
  let toolResultEvent: { event: string; data: string } | null = null
  if (pending.kind === 'read') {
    // A read that stalled is safe to run again; only "approved" means retry.
    if (body.decision !== 'approved') throw conflict('a read tool can only be retried')
    const executed = await executeTool(event, session, id, 'read', pending, { onAuditFailed: () => { auditFailed = true } })
    toolResultEvent = { event: 'tool_result', data: JSON.stringify({ call_id: pending.call_id, tool: pending.tool, kind: 'read', ok: executed.ok, summary_ar: pending.tool, summary_en: pending.tool }) }
    result = executed
  } else if (body.decision === 'rejected') {
    result = { ok: false, decision: 'rejected' }
    // Odoo accepts `rejected` for drafts only; a rejected write_light was never proposed to the audit.
    if (pending.kind === 'draft') {
      auditFailed = !await tryAudit(event, { conversation_id: id, kind: 'draft', tool_name: pending.tool, input: pending.input, result: 'rejected', http_status: null, draft: pending.input, approved: null, attested: false })
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
    response = await serviceFetch(event, 'POST', `${path}/resume`, session.owner, { call_id: body.call_id, result }, shield)
    if (wroteAlready && !response.ok) throw new Error('the service refused the resume')
  } catch (error) {
    // The write already happened: the browser is told so (a 200 stream), not left to think nothing was done.
    if (!wroteAlready) throw error
    logFailure('resume after the write failed', error)
    return settle(createEventStream(event), [...(auditFailed ? [auditFailedEvent()] : []), resumeFailedEvent(), doneEvent('failed')])
  }
  return relay(event, session, createEventStream(event), response, { runId: id, auditFailed, shielded: wroteAlready, preface: toolResultEvent ?? undefined })
})
