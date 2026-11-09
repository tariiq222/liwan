import { getCookie, getHeader, type H3Event } from 'h3'
import { createHash } from 'node:crypto'
import { AI_USAGE_BATCH_MAX, AiModelCallEventSchema, AiModelUsageEventSchema, type AiModelCallEvent, type AiModelUsageEvent, type AiUsageRecord } from '@liwan/contracts'
import { logFailure, odooJson } from './upstream'

type Attempt = { call: AiModelCallEvent; usage: AiModelUsageEvent | null }

/** Logged (class name only) when the service sends a usage event that cannot be trusted; the user's turn goes on without it. */
class MalformedUsageEvent extends Error {}
const skipped = (name: string) => logFailure(`skipped a malformed ${name} event`, new MalformedUsageEvent())

const abortedUsage = (callId: string): AiModelUsageEvent => ({ call_id: callId, outcome: 'aborted', input_tokens: null, output_tokens: null })

/** Odoo answered the usage report with a non-200 status. */
class UsageRefused extends Error {
  constructor(status: number) { super(`status ${status}`) }
}

/** Logged by count only: the spool reached its row bound, so its oldest rows were dropped. */
class UsageSpoolOverflow extends Error {}
/** Logged by count only: one session reached its own row bound, so its oldest rows there were dropped. */
class UsageSessionOverflow extends Error {}
/** Logged by count only: a run ended on a request that carried no session, so its rows had no owner to be reported under. */
class UsageUnattributed extends Error {}
/** Logged by count only: spooled rows waited past the age bound without Odoo accepting them. */
class UsageSpoolExpired extends Error {}

/**
 * Rows kept for a retry: at most 2048 in the process, oldest dropped first, none older than an hour. A busy tenant must not
 * evict the rows of another on a shared process, so each session also keeps at most `SPOOL_SESSION_MAX_ROWS` (issue #557).
 * A run reports at most a handful of attempts, so the per-session bound is far above any one conversation's need.
 */
const SPOOL_MAX_ROWS = 2048
const SPOOL_SESSION_MAX_ROWS = 256
const SPOOL_MAX_AGE_MS = 60 * 60 * 1000
/**
 * A refused row becomes due again this long after its refusal. It is bounded on purpose: a failing or ended session would
 * otherwise be retried by every run that ends in the same session, so one broken Odoo would take the load of every finished
 * run at once. Nothing is dropped by waiting: a row stays spooled until it is accepted or passes the age bound.
 */
const SPOOL_RETRY_AFTER_MS = 60 * 1000

/**
 * A row this process observed and Odoo has not accepted yet, with the hash of the session that observed it. Odoo derives the
 * owner of a usage row from the session that sends it, so a row is retried only under the session that produced it and is never
 * billed to whoever happens to flush next. Neither the session cookie nor the host is ever retained in clear or logged.
 */
type SpooledRow = { row: AiUsageRecord; session: string; observedAt: number; dueAt: number }
const spool: SpooledRow[] = []

/**
 * The reporting identity of one request: its tenant host and its Odoo session cookie, hashed. A shared process never mixes two
 * tenants. Only the session cookie keys it, so a UI language switch (`liwan-locale` in the same browser jar) never strands rows
 * an earlier request spooled (issue #557); a request with no session has no key.
 */
function sessionKey(event: H3Event): string {
  const session = getCookie(event, 'session_id')
  if (!session) return ''
  return createHash('sha256').update(`${getHeader(event, 'host') ?? ''}\n${session}`).digest('base64url').slice(0, 22)
}

/** Drops rows that waited past the age bound, naming the count only: no row payload ever reaches a log line. */
function expireSpooled(now: number): void {
  const kept = spool.filter(entry => now - entry.observedAt <= SPOOL_MAX_AGE_MS)
  const expired = spool.length - kept.length
  if (!expired) return
  spool.splice(0, spool.length, ...kept)
  logFailure(`expired ${expired} usage rows unaccepted for ${SPOOL_MAX_AGE_MS / 60_000} minutes`, new UsageSpoolExpired())
}

/** Drops the oldest rows one session holds beyond its own bound, so a busy session cannot push another's rows out. */
function enforceSessionBound(session: string): void {
  const held = spool.filter(entry => entry.session === session)
  const excess = held.length - SPOOL_SESSION_MAX_ROWS
  if (excess <= 0) return
  const dropped = new Set(held.slice(0, excess))
  for (let index = spool.length - 1; index >= 0; index--) if (dropped.has(spool[index]!)) spool.splice(index, 1)
  logFailure(`dropped ${excess} usage rows of one session over the ${SPOOL_SESSION_MAX_ROWS}-row bound`, new UsageSessionOverflow())
}

/**
 * Appends the rows of one run in the order the provider attempts were observed, then enforces both bounds: the session's own,
 * then the process's. A row of no session is never spooled: it could only be retried under that empty key, and Odoo bills a
 * usage row to the session that sends it (issue #557).
 */
function spoolRows(rows: readonly AiUsageRecord[], session: string): void {
  if (!session) {
    logFailure(`dropped ${rows.length} usage rows of a request with no session`, new UsageUnattributed())
    return
  }
  const now = Date.now()
  expireSpooled(now)
  for (const row of rows) spool.push({ row, session, observedAt: now, dueAt: now })
  enforceSessionBound(session)
  const excess = spool.length - SPOOL_MAX_ROWS
  if (excess <= 0) return
  spool.splice(0, excess)
  logFailure(`dropped ${excess} usage rows over the ${SPOOL_MAX_ROWS}-row spool bound`, new UsageSpoolOverflow())
}

function removeSpooled(accepted: readonly SpooledRow[]): void {
  const settled = new Set(accepted)
  for (let index = spool.length - 1; index >= 0; index--) if (settled.has(spool[index]!)) spool.splice(index, 1)
}

/**
 * Reports the rows this session still holds and is due, in batches of at most `AI_USAGE_BATCH_MAX` and in the order they were
 * observed. A batch leaves the spool only once Odoo answered 200, so a refusal, a timeout or a dead connection keeps every row
 * of it and makes it due again after the retry window. The rows behind a refused batch are deferred with it, so Odoo never
 * records a later attempt before an earlier one. A retry can repeat a row Odoo already stored and never counted it twice: the
 * row carries the provider's `call_id`, which Odoo holds once per user and conversation (issue #557).
 */
async function sendSpooled(event: H3Event, session: string): Promise<void> {
  const now = Date.now()
  const due = spool.filter(entry => entry.session === session && entry.dueAt <= now)
  for (let start = 0; start < due.length; start += AI_USAGE_BATCH_MAX) {
    const batch = due.slice(start, start + AI_USAGE_BATCH_MAX)
    try {
      const receipt = await odooJson(event, 'POST', '/api/v1/ai/usage', { body: { items: batch.map(entry => entry.row) }, signal: null })
      if (receipt.status !== 200) throw new UsageRefused(receipt.status)
    } catch (error) {
      logFailure(`usage report of ${batch.length} rows failed`, error)
      const retryAt = Date.now() + SPOOL_RETRY_AFTER_MS
      for (const entry of due.slice(start)) entry.dueAt = retryAt
      return
    }
    removeSpooled(batch)
  }
}

/**
 * One report at a time per session: two runs finishing together in the same session can never send the same spooled row twice,
 * while one session's slow report never holds another session or tenant back. An entry is dropped as soon as its chain settles.
 */
const reporting = new Map<string, Promise<void>>()

/**
 * Reports now what this request's session still holds and is due. Module-private: every `flush` calls it, so the next flush of
 * any ledger is the retry trigger for rows an earlier refused report left behind once their retry window passed. A retry needs a
 * request that still carries the reporting session's cookie (a usage row is billed to the session that sends it), so no timer
 * can do it alone. Serialized per session, and it never throws: a failure stays spooled for the next attempt.
 */
function retryPending(event: H3Event): Promise<void> {
  const session = sessionKey(event)
  // A request with no session gives the rows no owner to be reported under, so it neither sends nor waits.
  if (!session) return Promise.resolve()
  expireSpooled(Date.now())
  const report = (reporting.get(session) ?? Promise.resolve())
    .then(() => sendSpooled(event, session))
    .catch(error => logFailure('usage spool retry failed', error))
  reporting.set(session, report)
  void report.finally(() => { if (reporting.get(session) === report) reporting.delete(session) })
  return report
}

/**
 * The provider attempts of one `pumpRun`, reported to Odoo as usage rows. The AI service announces each attempt with
 * `model_call` and closes it with `model_usage`; both are for this server only and never reach the browser. An attempt
 * whose stream ended before its `model_usage` (a cut connection, the run deadline, the browser gone) is reported `aborted`.
 */
export function createUsageLedger() {
  const attempts = new Map<string, Attempt>()
  let flushed = false

  /**
   * Consumes a `model_call` / `model_usage` event (true), validated; any other event is left to the caller (false). Usage is
   * bookkeeping, never a reason to fail the user's turn: a malformed, repeated or unpaired event is logged and skipped, and a
   * `model_usage` that is malformed for a known call closes that call as `aborted`.
   */
  function observe(name: string, data: unknown): boolean {
    if (name === 'model_call') {
      const call = AiModelCallEventSchema.safeParse(data)
      if (!call.success || attempts.has(call.data.call_id)) skipped(name)
      else attempts.set(call.data.call_id, { call: call.data, usage: null })
      return true
    }
    if (name === 'model_usage') {
      const usage = AiModelUsageEventSchema.safeParse(data)
      const callId = usage.success ? usage.data.call_id : (data as { call_id?: unknown } | null)?.call_id
      const attempt = typeof callId === 'string' ? attempts.get(callId) : undefined
      if (!attempt || attempt.usage) skipped(name)
      else if (!usage.success) { skipped(name); attempt.usage = abortedUsage(attempt.call.call_id) }
      else attempt.usage = usage.data
      return true
    }
    return false
  }

  /** A service stream ended: every attempt it left open is `aborted`, without tokens. */
  function endStream(): void {
    for (const [callId, attempt] of attempts) {
      attempt.usage ??= abortedUsage(callId)
    }
  }

  const records = (conversationId: string): AiUsageRecord[] => [...attempts.values()].flatMap(({ call, usage }) => usage
    ? [{ conversation_id: conversationId, call_id: call.call_id, kind: call.kind, billing: call.billing, provider: call.provider, model: call.model, outcome: usage.outcome, input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, called_at: call.called_at }]
    : [])

  /**
   * Hands this run's attempts to the process spool once per ledger, in order, then reports what the spool holds for this
   * session. A batch Odoo refuses (a non-200, a timeout, a dead connection) stays spooled for the next flush of any ledger,
   * instead of dying with the session that observed it. A run whose request carried no session cookie has no owner for its
   * rows: they are dropped and logged by count, never spooled under an empty key (issue #557). The call is shielded from the
   * browser (`signal: null`) and runs after the browser stream closed, so a slow or failing report never holds the UI busy.
   *
   * Residual limit, stated rather than hidden: the report still runs as the user, so a session that ended mid-run (logout
   * elsewhere, revoked `ai.use`) is refused with 401/403. Those rows are never sent under another session, because Odoo would
   * bill that session's owner; they wait for the spool's age bound and are then reported by count. Counting them exactly needs
   * a server credential that reports without a user session, which is a separate owner decision.
   */
  async function flush(event: H3Event, conversationId: string): Promise<void> {
    if (flushed) return
    flushed = true
    try {
      const rows = records(conversationId)
      if (rows.length) spoolRows(rows, sessionKey(event))
      await retryPending(event)
    } catch (error) {
      // Bookkeeping never touches the user's turn, and this call is the last link of a chain nobody awaits: a request that
      // cannot even name its session is logged, not thrown into an unhandled rejection.
      logFailure('usage report could not be attempted', error)
    }
  }

  return { observe, endStream, flush }
}

export type UsageLedger = ReturnType<typeof createUsageLedger>
