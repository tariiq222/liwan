import { isError, type createEventStream, type H3Event } from 'h3'
import type { AiAuditRequest, AiTool } from '@webvue/contracts'
import { buildToolRequest, toolError, toolResultFromUpstream, type ToolResult } from './executor'
import { clientSignal, forwardUpstream, logFailure, odooJson, readSse, serviceFetch, type SignalOption } from './upstream'
import { createUsageLedger, type UsageLedger } from './usage'
import type { RunSession } from './session'

export type ExecutableKind = 'read' | 'write_light'
export type ToolCall = { call_id: string; tool: string; input: Record<string, unknown> }

/** Record one audit row as the caller. Odoo's refusal (limit reached, unknown tool, no capability) is forwarded. */
export async function audit(event: H3Event, body: AiAuditRequest, signal?: SignalOption): Promise<void> {
  const receipt = await odooJson(event, 'POST', '/api/v1/ai/audit', { body, signal })
  if (receipt.status !== 200) forwardUpstream(receipt)
}

/** Audit one row without ever throwing; returns whether Odoo recorded it. */
export async function tryAudit(event: H3Event, body: AiAuditRequest, signal?: SignalOption): Promise<boolean> {
  try { await audit(event, body, signal) } catch (error) { logFailure('audit failed', error); return false }
  return true
}

const upstreamUnavailable = (): ToolResult => ({ ok: false, error: { code: 'upstream_unavailable', message: 'Odoo is unavailable' } })

export type ExecuteOptions = { signal?: SignalOption; onAuditFailed?: () => void }

/**
 * Executes one tool of the request's own catalog as the caller and audits it. Only `read` and `write_light` tools are ever
 * executed here, and only under the kind the call claims; anything else is answered as a failed result without calling Odoo.
 * Never throws: an Odoo network failure or timeout becomes `upstream_unavailable`, and a failed audit is reported through
 * `onAuditFailed` while the real result is still returned.
 */
export async function executeTool(event: H3Event, session: RunSession, runId: string, kind: ExecutableKind, call: ToolCall, options: ExecuteOptions = {}): Promise<ToolResult> {
  const tool: AiTool | undefined = session.byName.get(call.tool)
  if (!tool) return toolError('unknown_tool', `${call.tool} is not in the catalog`)
  if ((tool.kind !== 'read' && tool.kind !== 'write_light') || tool.kind !== kind) {
    return toolError('not_executable', `${call.tool} cannot be executed as ${kind}`)
  }
  let built
  try { built = buildToolRequest(tool, call.input) } catch (error) {
    return toolError('invalid_arguments', (error as Error).message)
  }
  let result: ToolResult
  let status: number | null = null
  try {
    const upstream = await odooJson(event, built.method, built.path, { query: built.query, body: built.body, signal: options.signal })
    status = upstream.status
    result = toolResultFromUpstream(upstream.status, upstream.body, tool)
  } catch (error) {
    logFailure('odoo call failed', error)
    result = upstreamUnavailable()
  }
  const recorded = await tryAudit(event, {
    conversation_id: runId, kind, tool_name: tool.name, input: call.input,
    result: result.ok ? 'ok' : status === 403 ? 'denied' : 'failed', http_status: status, draft: null, approved: null, attested: false,
  }, options.signal)
  if (!recorded) options.onAuditFailed?.()
  return result
}

/** A write_light or draft tool_request the browser will act on must name a catalog tool of the same kind. */
function inCatalogAs(session: RunSession, call: ToolCall, kind: 'write_light' | 'draft'): boolean {
  return session.byName.get(call.tool)?.kind === kind
}

/** Only an error this server built with `createError` may speak: anything else is a fixed text and its class name, never its message. */
export function errorEvent(error: unknown) {
  if (isError(error)) {
    const data = error.data as { code?: unknown; message?: unknown } | undefined
    return { event: 'error', data: JSON.stringify({ code: typeof data?.code === 'string' ? data.code : 'internal', message: String(data?.message ?? error.message) }) }
  }
  return { event: 'error', data: JSON.stringify({ code: 'internal', message: `Unexpected error (${(error as object | null)?.constructor?.name ?? 'unknown'})` }) }
}
export const resumeFailedEvent = () => ({ event: 'error', data: JSON.stringify({ code: 'resume_failed', message: 'The action ran but the assistant could not continue' }) })
export const auditFailedEvent = () => ({ event: 'error', data: JSON.stringify({ code: 'audit_failed', message: 'The action ran but its audit record could not be saved' }) })
export const doneEvent = (status: 'failed') => ({ event: 'done', data: JSON.stringify({ status }) })
const push = (stream: EventStream, name: string, data: unknown) => stream.push({ event: name, data: JSON.stringify(data) })

type EventStream = ReturnType<typeof createEventStream>
type Action = { kind: 'read'; call: ToolCall & { summary_ar: string; summary_en: string } } | { kind: 'unknown'; call: ToolCall; message: string }
/** `runId`: the run this stream belongs to (named by this server for a new run, taken from the route for a resume); the service must echo it.
 * `shielded`: a claimed write was executed, so the service stream is read to its end even when the browser is gone (silently).
 * `preface`: one event the stream opens with (the result of a read the server ran again). */
export type PumpOptions = { runId: string; auditFailed?: boolean; shielded?: boolean; preface?: { event: string; data: string } }

/**
 * Relays the service stream to the browser. A tool_request the server must answer (a read, or a call the catalog does not back)
 * is acted on only after that service stream delivered its `done` and the reader was cancelled, so the service has saved its
 * waiting state before the resume arrives. Every stream ends with exactly one `done`; a failed audit shows up as `audit_failed`
 * just before it. When the browser is gone nothing more is executed or resumed; a shielded stream is still read to its end,
 * without pushing, so the run settles. The provider attempts the service reports (`model_call`, `model_usage`) are counted even
 * then, never relayed, and sent to Odoo once: before the final `done`, or, when the pump ends early or throws, as it unwinds.
 */
export async function pumpRun(event: H3Event, session: RunSession, stream: EventStream, response: Response, options: PumpOptions): Promise<void> {
  const usage = createUsageLedger()
  try {
    await relayRun(event, session, stream, response, options, usage)
  } finally {
    await usage.flush(event, options.runId)
  }
}

/** The events of one service stream that concern the browser: the provider usage events are taken out first (counted even when the browser is gone), and the attempts left open when the stream ends are closed. */
async function* serviceEvents(response: Response, usage: UsageLedger): AsyncGenerator<[string, any]> {
  try {
    for await (const [name, data] of readSse(response)) if (!usage.observe(name, data)) yield [name, data]
  } finally {
    usage.endStream()
  }
}

async function relayRun(event: H3Event, session: RunSession, stream: EventStream, response: Response, options: PumpOptions, usage: UsageLedger): Promise<void> {
  const gone = clientSignal(event)
  const { runId } = options
  if (options.preface) await stream.push(options.preface)
  let auditFailed = options.auditFailed ?? false
  let announced = false
  let finalDone: unknown = { status: 'failed' }
  let next: Response | null = response
  while (next) {
    const current: Response = next
    next = null
    let action: Action | null = null
    for await (const [name, data] of serviceEvents(current, usage)) {
      if (gone.aborted) {
        if (options.shielded) continue
        return
      }
      if (name === 'run') {
        if (data.run_id !== runId) throw createError({ statusCode: 502, data: { code: 'ai_upstream', message: 'AI service answered for another run' } })
        // A resumed service stream announces the run again; the browser hears it once.
        if (announced) continue
        announced = true
      }
      if (name === 'done') {
        // The done of a stream that is about to be resumed is not the end of the run.
        if (!action) finalDone = data
        break
      }
      if (name === 'tool_request' && action) continue
      if (name === 'tool_request' && data.kind === 'read') {
        action = { kind: 'read', call: data }
      } else if (name === 'tool_request' && (data.kind === 'write_light' || data.kind === 'draft') && !inCatalogAs(session, data, data.kind)) {
        // The browser never hears of it and nothing is audited; the service run is told and ends cleanly.
        action = { kind: 'unknown', call: data, message: `${data.tool} is not a ${data.kind} tool of the catalog` }
        continue
      } else if (name === 'tool_request' && data.kind === 'draft') {
        const recorded = await tryAudit(event, { conversation_id: runId, kind: 'draft', tool_name: data.tool, input: data.input, result: 'proposed', http_status: null, draft: data.input, approved: null, attested: false })
        auditFailed ||= !recorded
      }
      await push(stream, name, data)
    }
    if (gone.aborted) return
    if (!action) break
    const { call } = action
    let result: ToolResult
    if (action.kind === 'read') {
      result = await executeTool(event, session, runId, 'read', call, { onAuditFailed: () => { auditFailed = true } })
      if (gone.aborted) return
      await push(stream, 'tool_result', { call_id: call.call_id, tool: call.tool, kind: 'read', ok: result.ok, summary_ar: action.call.summary_ar, summary_en: action.call.summary_en })
    } else {
      result = toolError('unknown_tool', action.message)
    }
    next = await serviceFetch(event, 'POST', `/v1/runs/${encodeURIComponent(runId)}/resume`, session.owner, { call_id: call.call_id, result })
  }
  await usage.flush(event, runId)
  if (auditFailed) await stream.push(auditFailedEvent())
  await stream.push({ event: 'done', data: JSON.stringify(finalDone) })
}

/** Answers with a stream that carries only the given events (then closes): for a failure after the request was already accepted. */
export function settle(stream: EventStream, events: { event: string; data: string }[]) {
  Promise.resolve()
    .then(async () => { for (const item of events) await stream.push(item) })
    .finally(() => stream.close())
    .catch(error => logFailure('stream close failed', error))
  return stream.send()
}

/** Starts the pump in the background and returns the stream response; errors reach the browser as an `error` event followed by `done`. */
export function relay(event: H3Event, session: RunSession, stream: EventStream, response: Response, options: PumpOptions) {
  pumpRun(event, session, stream, response, options)
    .catch(async (error) => {
      if (clientSignal(event).aborted) { logFailure('stream after disconnect failed', error); return }
      try {
        await stream.push(errorEvent(error))
        await stream.push(doneEvent('failed'))
      } catch (pushError) { logFailure('stream push failed', pushError) }
    })
    .finally(() => stream.close())
    .catch(error => logFailure('stream close failed', error))
  return stream.send()
}
