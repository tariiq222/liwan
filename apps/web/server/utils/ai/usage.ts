import type { H3Event } from 'h3'
import { AI_USAGE_BATCH_MAX, AI_USAGE_SERVICE_LIMITS, AiModelCallEventSchema, AiModelUsageEventSchema, type AiModelCallEvent, type AiModelUsageEvent, type AiUsageRecord } from '@liwan/contracts'
import { markUsageRefused, usageRecorder, type UsageRecorder } from './recorder'
import { logFailure, odooServiceUsageJson } from './upstream'

type Attempt = { call: AiModelCallEvent; usage: AiModelUsageEvent | null }

/** Logged (class name only) when the service sends a usage event that cannot be trusted; the user's turn goes on without it. */
class MalformedUsageEvent extends Error {}
const skipped = (name: string) => logFailure(`skipped a malformed ${name} event`, new MalformedUsageEvent())

const abortedUsage = (callId: string): AiModelUsageEvent => ({ call_id: callId, outcome: 'aborted', input_tokens: null, output_tokens: null, cost: null, charge: null })

/** Odoo answered the usage report with a non-200 status. */
class UsageRefused extends Error {
  constructor(readonly status: number) { super(`status ${status}`) }
}

/** Logged by count only: the spool reached its row bound, so its oldest rows were dropped. */
class UsageSpoolOverflow extends Error {}
/** Logged by count only: one tenant reached its own row bound, so its oldest rows there were dropped. */
class UsageTenantOverflow extends Error {}
/** Logged by count only: spooled rows waited past the age bound without Odoo accepting them. */
class UsageSpoolExpired extends Error {}
/** Logged by count only: the run's user or company is not a usable id, so its rows could not be reported as that user. */
class UsageOwnerInvalid extends Error {}
/** Logged by count and field: Odoo refuses these rows now (422); they are kept and retried, and only the spool age bound expires them. */
class UsageRefusedRow extends Error {}
/** Logged by count only: Odoo already holds this row (409), so it leaves the spool without being lost. */
class UsageSettled extends Error {}

/**
 * Rows kept for a retry: at most 2048 in the process, oldest dropped first, none older than an hour. A busy tenant must not
 * evict the rows of another on a shared process, so each tenant also keeps at most `SPOOL_TENANT_MAX_ROWS` (issue #557).
 * A run reports at most a handful of attempts, so the per-tenant bound is far above any one run's need.
 */
const SPOOL_MAX_ROWS = 2048
const SPOOL_TENANT_MAX_ROWS = 1024
export const SPOOL_MAX_AGE_MS = 60 * 60 * 1000
/**
 * A refused row becomes due again this long after its refusal. It is bounded on purpose: one broken Odoo would otherwise take
 * the load of every finished run at once. Nothing is dropped by waiting: a row stays spooled until it is accepted or passes the
 * age bound.
 */
const SPOOL_RETRY_AFTER_MS = 60 * 1000

/** What the ledger needs of the run's session: the caller's id and the company the run started in, as `runSession` knew them at its start. */
export type ReportingRun = { owner: { user: string }; company: string }

/**
 * A row this process observed and Odoo has not accepted yet. `tenant` is the database it is recorded into (the recorder's
 * tenant), so a retry is sent only on that tenant's event with that tenant's credential: user and company ids repeat across the
 * databases of a shared process. `user` and `company` are the run's, named once per batch, never per row. The spool is memory
 * only: rows not yet accepted by Odoo are lost when this process restarts (residual window, `deploy/OPERATIONS.md`).
 */
type SpooledRow = { row: AiUsageRecord; tenant: string; user: number; company: number; observedAt: number; dueAt: number }
const spool: SpooledRow[] = []

const positiveId = (value: string): number => /^[1-9][0-9]{0,9}$/.test(value) ? Number(value) : 0

/**
 * Drops rows that waited past the age bound, naming the count only: no row payload ever reaches a log line. This is the only way
 * a row Odoo refused (or could not be asked about) is given up, and it is the last resort on purpose: this process keeps no
 * durable store, so rows wait in memory for an hour. There is no timer: a waiting row is retried when the next AI run ends on
 * this process, and at most once a minute per row. A server refusal alone never discards real usage. The two size bounds
 * (`SPOOL_MAX_ROWS`, `SPOOL_TENANT_MAX_ROWS`) still evict the oldest rows when they are exceeded, each with its own counted log line.
 */
function expireSpooled(now: number): void {
  const kept = spool.filter(entry => now - entry.observedAt <= SPOOL_MAX_AGE_MS)
  const expired = spool.length - kept.length
  if (!expired) return
  spool.splice(0, spool.length, ...kept)
  logFailure(`expired ${expired} usage rows unaccepted for ${SPOOL_MAX_AGE_MS / 60_000} minutes`, new UsageSpoolExpired())
}

/** Drops the oldest rows one tenant holds beyond its own bound, so a busy tenant cannot push another's rows out. */
function enforceTenantBound(tenant: string): void {
  const held = spool.filter(entry => entry.tenant === tenant)
  const excess = held.length - SPOOL_TENANT_MAX_ROWS
  if (excess <= 0) return
  const dropped = new Set(held.slice(0, excess))
  for (let index = spool.length - 1; index >= 0; index--) if (dropped.has(spool[index]!)) spool.splice(index, 1)
  logFailure(`dropped ${excess} usage rows of one tenant over the ${SPOOL_TENANT_MAX_ROWS}-row bound`, new UsageTenantOverflow())
}

/** Appends the rows of one run in the order the provider attempts were observed, then enforces both bounds: the tenant's own, then the process's. */
function spoolRows(rows: readonly AiUsageRecord[], tenant: string, user: number, company: number): void {
  const now = Date.now()
  expireSpooled(now)
  for (const row of rows) spool.push({ row, tenant, user, company, observedAt: now, dueAt: now })
  enforceTenantBound(tenant)
  const excess = spool.length - SPOOL_MAX_ROWS
  if (excess <= 0) return
  spool.splice(0, excess)
  logFailure(`dropped ${excess} usage rows over the ${SPOOL_MAX_ROWS}-row spool bound`, new UsageSpoolOverflow())
}

function removeSpooled(accepted: readonly SpooledRow[]): void {
  const settled = new Set(accepted)
  for (let index = spool.length - 1; index >= 0; index--) if (settled.has(spool[index]!)) spool.splice(index, 1)
}

const rowTokens = (row: AiUsageRecord): number => (row.input_tokens ?? 0) + (row.output_tokens ?? 0)

/**
 * Splits rows (in order) into requests Odoo accepts by size: at most `AI_USAGE_BATCH_MAX` rows and at most
 * `max_batch_tokens` tokens in all. One row is at most the per-row ceilings, so it always fits a request alone.
 */
function chunkRows(entries: readonly SpooledRow[]): SpooledRow[][] {
  const chunks: SpooledRow[][] = []
  let tokens = 0
  for (const entry of entries) {
    const current = chunks.at(-1)
    const size = rowTokens(entry.row)
    if (current && current.length < AI_USAGE_BATCH_MAX && tokens + size <= AI_USAGE_SERVICE_LIMITS.max_request_tokens) { current.push(entry); tokens += size }
    else { chunks.push([entry]); tokens = size }
  }
  return chunks
}

/** What Odoo named in a 409/422/429 body: the refused field (`items.<i>.<field>`, `items`, `user_id`, ...) and the back-off it asked for. */
function refusalOf(body: unknown): { field: string; retryAfterMs: number } {
  const { field, details } = (body && typeof body === 'object' ? body : {}) as { field?: unknown; details?: { retry_after_seconds?: unknown } }
  const seconds = Number(details?.retry_after_seconds)
  return { field: typeof field === 'string' ? field : '', retryAfterMs: Number.isFinite(seconds) ? Math.min(Math.max(seconds, 0), 600) * 1000 : 0 }
}

/**
 * Reports every due row of this request's tenant with that tenant's credential, one request per user and company in the order the rows
 * were observed, sized the way Odoo admits them (`chunkRows`). A row leaves the spool in exactly two ways: Odoo has it, or the
 * spool age bound expires it (`expireSpooled`, which logs the count, and is the last resort for a row Odoo will not take: this
 * process keeps no other store, and a refusal is never a licence to discard real usage; the 2048-row process bound and the 1024-row
 * per-tenant bound still evict the oldest rows, each with a counted log line). Retries happen when the next AI run ends on this
 * process, at most once a minute per row; there is no timer. Every server answer:
 *  - 200: recorded; the rows leave the spool.
 *  - 409 naming `items.<i>.<field>`: that row is already held (under another company); Odoo has it, so it leaves the spool.
 *  - 422 naming `items.<i>.<field>` (size, `called_at`, ...): the server will not take that row now. It is KEPT, deferred for
 *    the retry window and logged loudly with the field; the other rows of the request are sent again at once. It cannot come
 *    from a size ceiling the executor can legitimately exceed (the only per-row bound is the AI service's own wire contract).
 *  - 422 naming `items` (the request is above the per-minute token ceiling): split in halves; a lone row that is still refused is kept.
 *  - 422 naming the owner (`user_id`, `user_company_id`): this owner's rows are kept and deferred, loudly, until the age bound.
 *  - 429: the recorder is over its budget. Every due row backs off for what Odoo asked (at least the retry window); nothing is lost.
 *  - 401/403: the credential is wrong or revoked, nothing else would pass either; the tenant is marked refused (the run gate then
 *    refuses new runs) and every due row of the tenant backs off.
 *  - a timeout, a 5xx, a dead connection: the request and the rows behind it of this owner keep for the retry window.
 */
async function sendSpooled(event: H3Event, recorder: UsageRecorder): Promise<void> {
  const now = Date.now()
  const mine = spool.filter(entry => entry.tenant === recorder.tenant && entry.dueAt <= now)
  const groups = new Map<string, SpooledRow[]>()
  for (const entry of mine) { const owner = `${entry.user}:${entry.company}`; groups.set(owner, [...(groups.get(owner) ?? []), entry]) }
  const deferAll = (retryAfterMs: number) => {
    const retryAt = Date.now() + Math.max(SPOOL_RETRY_AFTER_MS, retryAfterMs)
    for (const entry of mine) entry.dueAt = retryAt
  }
  const keep = (entries: readonly SpooledRow[]) => { for (const entry of entries) entry.dueAt = Date.now() + SPOOL_RETRY_AFTER_MS }
  for (const due of groups.values()) {
    const { user, company } = due[0]!
    const queue = chunkRows(due)
    while (queue.length) {
      const batch = queue.shift()!
      let receipt: { status: number; body: unknown }
      try {
        receipt = await odooServiceUsageJson(event, recorder.bearer, { user_id: user, user_company_id: company, items: batch.map(entry => entry.row) })
      } catch (error) {
        logFailure(`usage report of ${batch.length} rows failed`, error)
        keep([batch, ...queue].flat())
        break
      }
      if (receipt.status === 200) { removeSpooled(batch); continue }
      if (receipt.status === 401 || receipt.status === 403 || receipt.status === 429) {
        logFailure(`usage report of ${batch.length} rows failed with status ${receipt.status}`, new UsageRefused(receipt.status))
        if (receipt.status !== 429) markUsageRefused(recorder.tenant)
        deferAll(receipt.status === 429 ? refusalOf(receipt.body).retryAfterMs : 0)
        return
      }
      if (receipt.status === 409 || receipt.status === 422) {
        const { field } = refusalOf(receipt.body)
        const index = Number(/^items\.(\d+)\./.exec(field)?.[1] ?? NaN)
        if (Number.isInteger(index) && index < batch.length) {
          const row = batch[index]!
          if (receipt.status === 409) {
            logFailure('settled 1 usage row Odoo already holds (409)', new UsageSettled())
            removeSpooled([row])
          } else {
            logFailure(`KEPT 1 usage row Odoo refuses (422 ${field}); it is retried until the spool age bound`, new UsageRefusedRow())
            keep([row])
          }
          queue.unshift(...chunkRows(batch.filter((_, position) => position !== index)))
        } else if (field === 'items' && batch.length > 1) {
          const half = Math.ceil(batch.length / 2)
          queue.unshift(batch.slice(0, half), batch.slice(half))
        } else {
          logFailure(`KEPT ${batch.length} usage rows Odoo refuses as a whole (${receipt.status} ${field || 'no field'}); they are retried until the spool age bound`, new UsageRefusedRow())
          keep([batch, ...queue].flat())
          break
        }
        continue
      }
      logFailure(`usage report of ${batch.length} rows failed with status ${receipt.status}`, new UsageRefused(receipt.status))
      keep([batch, ...queue].flat())
      break
    }
  }
}

/**
 * One report at a time per tenant: two runs finishing together can never send the same spooled row twice, while one tenant's slow
 * report never holds another back. An entry is dropped as soon as its chain settles.
 */
const reporting = new Map<string, Promise<void>>()

function chain(name: string, send: () => Promise<void>): Promise<void> {
  expireSpooled(Date.now())
  const report = (reporting.get(name) ?? Promise.resolve())
    .then(send)
    .catch(error => logFailure('usage spool retry failed', error))
  reporting.set(name, report)
  void report.finally(() => { if (reporting.get(name) === report) reporting.delete(name) })
  return report
}

/**
 * Reports now what this tenant's spool still holds and is due. Every `flush` calls it, so the next flush of any ledger is the
 * retry trigger for rows an earlier refused report left behind once their retry window passed. Serialized per tenant, and it
 * never throws: a failure stays spooled for the next attempt.
 */
const retryPending = (event: H3Event, recorder: UsageRecorder): Promise<void> => chain(recorder.tenant, () => sendSpooled(event, recorder))

/** Retries the rows of this request's tenant that waited, used when the run gate finds the recorder healthy again. Never throws. */
export function retryUsage(event: H3Event): Promise<void> {
  try { return retryPending(event, usageRecorder(event)) } catch (error) {
    logFailure('usage spool retry could not be attempted', error)
    return Promise.resolve()
  }
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
    ? [{ conversation_id: conversationId, call_id: call.call_id, kind: call.kind, capability: call.capability, billing: call.billing, provider: call.provider, model: call.model, outcome: usage.outcome, input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, cost: usage.cost, charge: usage.charge, called_at: call.called_at }]
    : [])

  /**
   * Hands this run's attempts to the process spool once per ledger, in order, then reports what the tenant's spool holds. The rows
   * are reported as the run's user with the tenant's derived credential (`recorder.ts`), so a session that ended mid-run (logout,
   * an expired cookie, a revoked `ai.use`) no longer loses them, and any flush retries the due rows of its own tenant only. A run
   * without a usable user or company, or a request with no usable credential, is dropped and logged by count, never sent. Every
   * failure to record is logged by class and count, never silently dropped. The call is shielded from the browser and runs after
   * the browser stream closed, so a slow or failing report never holds the UI busy.
   *
   * Residual limits, stated rather than hidden: the spool is in memory, so rows Odoo has not yet accepted are lost if this process
   * restarts, and a spooled row is retried only when some later run ends (no timer, because a retry needs a live request for the
   * release and tenant binding) and is given up after the age bound.
   */
  async function flush(event: H3Event, conversationId: string, run: ReportingRun): Promise<void> {
    if (flushed) return
    flushed = true
    try {
      const rows = records(conversationId)
      const user = positiveId(run.owner.user)
      const company = positiveId(run.company)
      if (!user || !company) { logFailure(`dropped ${rows.length} usage rows of a run with no usable user or company`, new UsageOwnerInvalid()); return }
      let recorder: UsageRecorder
      try { recorder = usageRecorder(event) } catch (error) {
        if (rows.length) logFailure(`dropped ${rows.length} usage rows of a run with no usable recorder`, error)
        return
      }
      if (rows.length) spoolRows(rows, recorder.tenant, user, company)
      await retryPending(event, recorder)
    } catch (error) {
      // Bookkeeping never touches the user's turn, and this call is the last link of a chain nobody awaits: a failure here is
      // logged, not thrown into an unhandled rejection.
      logFailure('usage report could not be attempted', error)
    }
  }

  return { observe, endStream, flush }
}

export type UsageLedger = ReturnType<typeof createUsageLedger>
