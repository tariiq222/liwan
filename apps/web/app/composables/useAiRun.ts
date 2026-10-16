import { getCurrentScope, onScopeDispose, ref } from 'vue'
import { AiEventSchema, AiRunStatusSchema, type AiEvent, type AiRecordRef, type AiRunStatus, type AiRunStatusValue } from '@nasq/contracts'

export type AiThreadItem =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string; records: AiRecordRef[]; streaming: boolean }
  | { kind: 'tool'; callId: string; summaryAr: string; summaryEn: string; state: 'running' | 'ok' | 'denied' | 'failed' | 'stalled' }
  | { kind: 'confirm'; callId: string; tool: string; input: Record<string, unknown>; summaryAr: string; summaryEn: string; state: 'pending' | 'approved' | 'rejected'; busy?: boolean }
  | { kind: 'draft'; callId: string; tool: string; payload: Record<string, unknown>; summaryAr: string; summaryEn: string; state: 'pending' | 'approved' | 'rejected' }

export type AiLimit = 'max_tool_calls' | 'max_steps' | 'timeout' | 'messages_monthly'
export type AiRunState = 'idle' | 'streaming' | 'waiting_user' | 'done' | 'failed' | 'limit_reached'
type LocalEvent = AiEvent | { event: 'decided'; data: { call_id: string; decision: 'approved' | 'rejected' | 'pending' } }
type DecidableItem = Extract<AiThreadItem, { kind: 'confirm' | 'draft' }>

const MONTHLY_LIMIT_KEY = 'ai.messages.monthly'
const ERROR_MESSAGES: Record<string, string> = {
  provider_unavailable: 'ai.errors.provider',
  audit_failed: 'ai.errors.auditFailed',
  resume_failed: 'ai.errors.resumeFailed',
}

export function parseSseChunk(buffer: string): { events: AiEvent[]; rest: string } {
  const events: AiEvent[] = []
  let rest = buffer
  let index: number
  while ((index = rest.indexOf('\n\n')) >= 0) {
    const block = rest.slice(0, index)
    rest = rest.slice(index + 2)
    const name = block.match(/^event: (.+)$/m)?.[1]
    const data = block.match(/^data: (.+)$/m)?.[1]
    if (name && data) events.push(AiEventSchema.parse({ event: name, data: JSON.parse(data) }))
  }
  return { events, rest }
}

export function applyEvent(items: AiThreadItem[], event: LocalEvent): AiThreadItem[] {
  const next = [...items]
  const last = next.at(-1)
  switch (event.event) {
    case 'token': {
      if (last?.kind === 'assistant' && last.streaming) next[next.length - 1] = { ...last, text: last.text + event.data.text }
      else next.push({ kind: 'assistant', text: event.data.text, records: [], streaming: true })
      return next
    }
    case 'answer': {
      const item = { kind: 'assistant' as const, text: event.data.text, records: event.data.records, streaming: false }
      if (last?.kind === 'assistant' && last.streaming) next[next.length - 1] = item
      else next.push(item)
      return next
    }
    case 'tool_request': {
      // Text streamed before a tool call is final: close it so it does not stay "thinking".
      if (last?.kind === 'assistant' && last.streaming) next[next.length - 1] = { ...last, streaming: false }
      const base = { callId: event.data.call_id, summaryAr: event.data.summary_ar, summaryEn: event.data.summary_en }
      if (event.data.kind === 'read') next.push({ kind: 'tool', ...base, state: 'running' })
      else if (event.data.kind === 'draft') next.push({ kind: 'draft', ...base, tool: event.data.tool, payload: event.data.input, state: 'pending' })
      else next.push({ kind: 'confirm', ...base, tool: event.data.tool, input: event.data.input, state: 'pending' })
      return next
    }
    case 'tool_result': {
      const index = next.findIndex(item => item.kind === 'tool' && item.callId === event.data.call_id)
      if (index >= 0) next[index] = { ...(next[index] as Extract<AiThreadItem, { kind: 'tool' }>), state: event.data.ok ? 'ok' : 'denied' }
      return next
    }
    case 'decided': {
      const index = next.findIndex(item => (item.kind === 'confirm' || item.kind === 'draft' || item.kind === 'tool') && item.callId === event.data.call_id)
      const found = next[index]
      // A stalled read is retried with "approved": it runs again, and goes back to stalled if the server never took the retry.
      if (found?.kind === 'tool') next[index] = { ...found, state: event.data.decision === 'pending' ? 'stalled' : 'running' }
      else if (found) next[index] = { ...(found as DecidableItem), state: event.data.decision }
      return next
    }
    default:
      return next
  }
}

export function useAiRun() {
  const runId = ref<string | null>(null)
  const status = ref<AiRunState>('idle')
  const items = ref<AiThreadItem[]>([])
  const limit = ref<AiLimit | null>(null)
  const error = ref<string | null>(null)
  // The service or the feature is switched off (503 ai_unavailable): the page shows a state, not an error.
  const unavailable = ref(false)
  const { t } = useI18n()

  // One controller owns every request of this composable; leaving the page cancels them.
  const lifecycle = new AbortController()
  if (getCurrentScope()) onScopeDispose(() => lifecycle.abort())
  let busy = false
  const deciding = new Set<string>()

  function fail(message: string) {
    error.value = message
    status.value = 'failed'
  }

  async function refuse(response: Response) {
    const body = await response.json().catch(() => null)
    const code: string | undefined = body?.data?.code ?? body?.code
    if (response.status === 403 && code === 'feature_not_included' && (body?.data?.details ?? body?.details)?.limit_key === MONTHLY_LIMIT_KEY) {
      limit.value = 'messages_monthly'
      status.value = 'limit_reached'
    } else if (response.status === 503 && code === 'ai_unavailable') {
      unavailable.value = true
      status.value = 'idle'
    } else {
      fail(t('errors.generic'))
    }
  }

  async function consume(body: ReadableStream<Uint8Array>) {
    status.value = 'streaming'
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let finished = false
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const parsed = parseSseChunk(buffer)
      buffer = parsed.rest
      for (const event of parsed.events) {
        if (event.event === 'run') runId.value = event.data.run_id
        else if (event.event === 'limit_reached') limit.value = event.data.limit
        // The event text is never shown: only the code picks one of the fixed messages.
        else if (event.event === 'error') {
          error.value = t(ERROR_MESSAGES[event.data.code] ?? 'errors.generic')
          status.value = 'failed'
        }
        else if (event.event === 'done') {
          finished = true
          status.value = event.data.status === 'waiting_user' ? 'waiting_user' : event.data.status === 'waiting_tool' || event.data.status === 'running' ? 'streaming' : event.data.status
        }
        items.value = applyEvent(items.value, event)
      }
    }
    // A stream that closes without `done` never finishes the run: do not leave the UI streaming.
    if (!finished && status.value === 'streaming') fail(t('errors.generic'))
  }

  /** True when the server took the request (even if the stream broke later); false when it never got there. */
  async function post(url: string, body: unknown): Promise<boolean> {
    busy = true
    let accepted = false
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: lifecycle.signal })
      if (!response.ok || !response.body) {
        await refuse(response)
        return false
      }
      accepted = true
      await consume(response.body)
      return true
    } catch {
      if (lifecycle.signal.aborted) return true
      fail(t('errors.generic'))
      return accepted
    } finally {
      busy = false
    }
  }

  async function send(message: string, context?: { page: string; id?: number | null } | null) {
    if (busy) return
    error.value = null
    limit.value = null
    items.value = [...items.value, { kind: 'user', text: message }]
    await post('/api/ai/runs', { message, context: context ?? null, run_id: runId.value ?? undefined })
  }

  /**
   * `data` is only sent for a submitted draft (`{id}` of the created record); write_light results come from the server.
   * Also retries a stalled read ("approved"). Returns whether the server took the decision: only then is a card final, and only
   * a request that never reached the server puts it back to pending (an accepted decision whose stream failed stays decided).
   */
  async function decide(callId: string, decision: 'approved' | 'rejected', data?: Record<string, unknown>): Promise<boolean> {
    if (!runId.value || busy || deciding.has(callId)) return false
    deciding.add(callId)
    error.value = null
    items.value = applyEvent(items.value, { event: 'decided', data: { call_id: callId, decision } })
    try {
      const reached = await post(`/api/ai/runs/${encodeURIComponent(runId.value)}/resume`, { call_id: callId, decision, data })
      if (!reached) {
        // The server never recorded the decision: the card is answerable again; no automatic retry.
        items.value = applyEvent(items.value, { event: 'decided', data: { call_id: callId, decision: 'pending' } })
        unavailable.value = false
        limit.value = null
        error.value = t('ai.errors.decide')
        status.value = 'waiting_user'
      }
      return reached
    } finally {
      deciding.delete(callId)
    }
  }

  /**
   * A run reopened by link: nothing streams to this page, so no state may wait for a stream. `waiting_tool` with a pending call
   * and `executing` ask the user (retry, or wait for the earlier request); `running` is streaming only while this page's own request is.
   */
  function loadedStatus(value: AiRunStatusValue, pending: AiRunStatus['pending']): AiRunState {
    if (value === 'executing') return 'waiting_user'
    if (value === 'waiting_tool') return pending ? 'waiting_user' : 'idle'
    if (value === 'running') return busy ? 'streaming' : 'idle'
    return value
  }

  async function load(id: string) {
    try {
      const response = await fetch(`/api/ai/runs/${encodeURIComponent(id)}`, { signal: lifecycle.signal })
      if (!response.ok) return await refuse(response)
      const run = AiRunStatusSchema.parse(await response.json())
      runId.value = run.run_id
      let rebuilt: AiThreadItem[] = run.messages.map(m => m.role === 'user' ? { kind: 'user', text: m.content } : { kind: 'assistant', text: m.content, records: [], streaming: false })
      // The status endpoint carries no summary text; the card falls back to the tool name.
      if (run.pending) rebuilt = applyEvent(rebuilt, { event: 'tool_request', data: { ...run.pending, summary_ar: run.pending.tool, summary_en: run.pending.tool } })
      status.value = loadedStatus(run.status, run.pending)
      // A pending read nobody is running is offered again; a claimed write belongs to an earlier request and cannot be answered.
      if (run.pending?.kind === 'read' && run.status === 'waiting_tool') rebuilt = rebuilt.map(item => item.kind === 'tool' && item.callId === run.pending!.call_id ? { ...item, state: 'stalled' } : item)
      if (run.pending?.kind === 'write_light' && run.status === 'executing') rebuilt = rebuilt.map(item => item.kind === 'confirm' && item.callId === run.pending!.call_id ? { ...item, busy: true } : item)
      items.value = rebuilt
    } catch {
      if (!lifecycle.signal.aborted) fail(t('errors.generic'))
    }
  }

  return { runId, status, items, limit, error, unavailable, send, decide, load }
}
