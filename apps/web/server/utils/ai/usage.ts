import { createError, type H3Event } from 'h3'
import { AI_USAGE_BATCH_MAX, AiModelCallEventSchema, AiModelUsageEventSchema, type AiModelCallEvent, type AiModelUsageEvent, type AiUsageRecord } from '@webvue/contracts'
import { logFailure, odooJson } from './upstream'

type Attempt = { call: AiModelCallEvent; usage: AiModelUsageEvent | null }

const malformed = () => createError({ statusCode: 502, data: { code: 'ai_upstream', message: 'AI service sent a malformed event' } })

/**
 * The provider attempts of one `pumpRun`, reported to Odoo as usage rows. The AI service announces each attempt with
 * `model_call` and closes it with `model_usage`; both are for this server only and never reach the browser. An attempt
 * whose stream ended before its `model_usage` (a cut connection, the run deadline, the browser gone) is reported `aborted`.
 */
export function createUsageLedger() {
  const attempts = new Map<string, Attempt>()
  let flushed = false

  /** Consumes a `model_call` / `model_usage` event (true), validated; any other event is left to the caller (false). */
  function observe(name: string, data: unknown): boolean {
    if (name === 'model_call') {
      const call = AiModelCallEventSchema.safeParse(data)
      if (!call.success || attempts.has(call.data.call_id)) throw malformed()
      attempts.set(call.data.call_id, { call: call.data, usage: null })
      return true
    }
    if (name === 'model_usage') {
      const usage = AiModelUsageEventSchema.safeParse(data)
      const attempt = usage.success ? attempts.get(usage.data.call_id) : undefined
      if (!usage.success || !attempt || attempt.usage) throw malformed()
      attempt.usage = usage.data
      return true
    }
    return false
  }

  /** A service stream ended: every attempt it left open is `aborted`, without tokens. */
  function endStream(): void {
    for (const [callId, attempt] of attempts) {
      attempt.usage ??= { call_id: callId, outcome: 'aborted', input_tokens: null, output_tokens: null }
    }
  }

  const records = (conversationId: string): AiUsageRecord[] => [...attempts.values()].flatMap(({ call, usage }) => usage
    ? [{ conversation_id: conversationId, kind: call.kind, provider: call.provider, model: call.model, outcome: usage.outcome, input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, called_at: call.called_at }]
    : [])

  /**
   * Sends the attempts to Odoo, once per ledger, in batches of at most `AI_USAGE_BATCH_MAX` rows. The call is shielded from the
   * browser (`signal: null`). It never throws: a refusal or a failure is logged on the server (class name and row count) only.
   */
  async function flush(event: H3Event, conversationId: string): Promise<void> {
    if (flushed) return
    flushed = true
    const rows = records(conversationId)
    for (let start = 0; start < rows.length; start += AI_USAGE_BATCH_MAX) {
      const items = rows.slice(start, start + AI_USAGE_BATCH_MAX)
      try {
        const receipt = await odooJson(event, 'POST', '/api/v1/ai/usage', { body: { items }, signal: null })
        if (receipt.status !== 200) throw new UsageRefused(receipt.status)
      } catch (error) {
        logFailure(`usage report of ${items.length} rows failed`, error)
      }
    }
  }

  return { observe, endStream, flush }
}

export type UsageLedger = ReturnType<typeof createUsageLedger>

/** Odoo answered the usage report with a non-200 status. */
class UsageRefused extends Error {
  constructor(status: number) { super(`status ${status}`) }
}
