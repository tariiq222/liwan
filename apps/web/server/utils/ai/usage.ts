import { getCookie, getHeader, type H3Event } from 'h3'
import { createHash } from 'node:crypto'
import { AI_USAGE_BATCH_MAX, AI_USAGE_SERVICE_LIMITS, AiModelCallEventSchema, AiModelUsageEventSchema, type AiModelCallEvent, type AiModelUsageEvent, type AiUsageRecord } from '@liwan/contracts'
import { BEARER_KEY } from '../serviceAuthorization'
import { logFailure, odooJson, odooServiceUsageJson } from './upstream'

type Attempt = { call: AiModelCallEvent; usage: AiModelUsageEvent | null }

/** Logged (class name only) when the service sends a usage event that cannot be trusted; the user's turn goes on without it. */
class MalformedUsageEvent extends Error {}
const skipped = (name: string) => logFailure(`skipped a malformed ${name} event`, new MalformedUsageEvent())

const abortedUsage = (callId: string): AiModelUsageEvent => ({ call_id: callId, outcome: 'aborted', input_tokens: null, output_tokens: null })

/** Odoo answered the usage report with a non-200 status. */
class UsageRefused extends Error {
  constructor(readonly status: number) { super(`status ${status}`) }
}

/** Logged by count only: the spool reached its row bound, so its oldest rows were dropped. */
class UsageSpoolOverflow extends Error {}
/** Logged by count only: one session reached its own row bound, so its oldest rows there were dropped. */
class UsageSessionOverflow extends Error {}
/** Logged by count only: a run ended on a request that carried no session, so its rows had no owner to be reported under. */
class UsageUnattributed extends Error {}
/** Logged by count only: spooled rows waited past the age bound without Odoo accepting them. */
class UsageSpoolExpired extends Error {}
/** Logged by count only: the recorder key is set but is not an Odoo API key, so the report falls back to the user's session. */
class UsageKeyMalformed extends Error {}
/** Logged by count only: the run's user or company is not a usable id, so its rows could not be reported as that user. */
class UsageOwnerInvalid extends Error {}
/** Logged by count and field: Odoo refuses these rows now (422); they are kept and retried, and only the spool age bound expires them. */
class UsageRefusedRow extends Error {}
/** Logged by count only: Odoo already holds this row (409), so it leaves the spool without being lost. */
class UsageSettled extends Error {}

/**
 * Rows kept for a retry: at most 2048 in the process, oldest dropped first, none older than an hour. A busy tenant must not
 * evict the rows of another on a shared process, so each session also keeps at most `SPOOL_SESSION_MAX_ROWS` (issue #557).
 * A run reports at most a handful of attempts, so the per-session bound is far above any one conversation's need.
 */
const SPOOL_MAX_ROWS = 2048
const SPOOL_SESSION_MAX_ROWS = 256
export const SPOOL_MAX_AGE_MS = 60 * 60 * 1000
/**
 * A refused row becomes due again this long after its refusal. It is bounded on purpose: a failing or ended session would
 * otherwise be retried by every run that ends in the same session, so one broken Odoo would take the load of every finished
 * run at once. Nothing is dropped by waiting: a row stays spooled until it is accepted or passes the age bound.
 */
const SPOOL_RETRY_AFTER_MS = 60 * 1000

/** The user and company a service-reported run belongs to: the batch names them, a row never does. */
type ServiceOwner = { user: number; company: number }
/** What the ledger needs of the run's session to report as its user: the caller's id and current company, as `runSession` knows them. */
export type ReportingRun = { owner: { user: string }; company: string }

/**
 * A row this process observed and Odoo has not accepted yet. `session` is the key its retries are grouped and bounded by: the hash
 * of the session that observed it (Odoo derives the owner of a cookie-reported row from the session that sends it, so such a row
 * is retried only under that session and is never billed to whoever happens to flush next), or `service:<user>:<company>` for a
 * row reported with the deployment's recorder key, which is retried by any later flush because the key, not a session, speaks for
 * it. Neither the session cookie, the recorder key nor the host is ever retained in clear or logged. The spool is memory only:
 * rows not yet accepted by Odoo are lost when this process restarts (residual window, `deploy/OPERATIONS.md`).
 */
type SpooledRow = { row: AiUsageRecord; session: string; service: ServiceOwner | null; observedAt: number; dueAt: number }
const spool: SpooledRow[] = []

/**
 * The deployment's recorder key (an Odoo API key of the tenant's technical usage account), or '' when this process reports as the
 * user. Only a dedicated deployment has one: a shared process serves many tenants and no single key can speak for them (the
 * shared-SaaS key is a later step of issue #557), so there it keeps reporting with the user's session. Read from the server's
 * own environment on every call, never from runtime config the client could reach.
 */
function recorderKey(): string {
  if ((process.env.LIWAN_TENANCY_MODE ?? 'dedicated') !== 'dedicated') return ''
  const key = process.env.LIWAN_AI_USAGE_KEY ?? ''
  if (!key) return ''
  if (!BEARER_KEY.test(`Bearer ${key}`)) {
    logFailure('LIWAN_AI_USAGE_KEY is set but is not an Odoo API key; reporting usage as the user instead', new UsageKeyMalformed())
    return ''
  }
  return key
}

const serviceKeyOf = (owner: ServiceOwner): string => `service:${owner.user}:${owner.company}`
const positiveId = (value: string): number => /^[1-9][0-9]{0,9}$/.test(value) ? Number(value) : 0

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

/**
 * Drops rows that waited past the age bound, naming the count only: no row payload ever reaches a log line. This is the only way
 * a row Odoo refused (or could not be asked about) is given up, and it is the last resort on purpose: this process keeps no
 * durable store (adding one would be new infrastructure), so rows wait in memory for an hour. There is no timer: a waiting row
 * is retried when the next AI run ends on this process, and at most once a minute per row, so a quiet tenant can let rows reach
 * the age bound even after Odoo has recovered. They are then expired with a count that an operator can alert on. A server
 * refusal alone never discards real usage. The two size bounds (`SPOOL_MAX_ROWS`, `SPOOL_SESSION_MAX_ROWS`) still evict the
 * oldest rows when they are exceeded, each with its own counted log line.
 */
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
function spoolRows(rows: readonly AiUsageRecord[], session: string, service: ServiceOwner | null = null): void {
  if (!session) {
    logFailure(`dropped ${rows.length} usage rows of a request with no session`, new UsageUnattributed())
    return
  }
  const now = Date.now()
  expireSpooled(now)
  for (const row of rows) spool.push({ row, session, service, observedAt: now, dueAt: now })
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
  const due = spool.filter(entry => !entry.service && entry.session === session && entry.dueAt <= now)
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
 * Reports every due row of the service owners with the recorder key, one request per user and company in the order the rows
 * were observed, sized the way Odoo admits them (`chunkRows`). A row leaves the spool in exactly two ways: Odoo has it, or the
 * spool age bound expires it (`expireSpooled`, which logs the count, and is the last resort for a row Odoo will not take: this
 * process keeps no other store, and a refusal is never a licence to discard real usage; the 2048-row process bound and the 256-row
 * per-owner bound still evict the oldest rows, each with a counted log line). Retries happen when the next AI run ends on this
 * process, at most once a minute per row; there is no timer. Every server answer:
 *  - 200: recorded; the rows leave the spool.
 *  - 409 naming `items.<i>.<field>`: that row is already held (under another company); Odoo has it, so it leaves the spool.
 *  - 422 naming `items.<i>.<field>` (size, `called_at`, ...): the server will not take that row now. It is KEPT, deferred for
 *    the retry window and logged loudly with the field; the other rows of the request are sent again at once. It cannot come
 *    from a size ceiling the executor can legitimately exceed (the only per-row bound is the AI service's own wire contract).
 *  - 422 naming `items` (the request is above the per-minute token ceiling): split in halves; a lone row that is still refused is kept.
 *  - 422 naming the owner (`user_id`, `user_company_id`): this owner's rows are kept and deferred, loudly, until the age bound.
 *  - 429: the recorder is over its budget. Every due row backs off for what Odoo asked (at least the retry window); nothing is lost.
 *  - 401/403: the key is wrong or revoked, nothing else would pass either; every due row backs off.
 *  - a timeout, a 5xx, a dead connection: the request and the rows behind it of this owner keep for the retry window.
 */
async function sendServiceSpooled(event: H3Event, key: string): Promise<void> {
  const now = Date.now()
  const groups = new Map<string, SpooledRow[]>()
  for (const entry of spool) if (entry.service && entry.dueAt <= now) groups.set(entry.session, [...(groups.get(entry.session) ?? []), entry])
  const deferAll = (retryAfterMs: number) => {
    const retryAt = Date.now() + Math.max(SPOOL_RETRY_AFTER_MS, retryAfterMs)
    for (const entry of spool) if (entry.service && entry.dueAt <= now) entry.dueAt = retryAt
  }
  const keep = (entries: readonly SpooledRow[]) => { for (const entry of entries) entry.dueAt = Date.now() + SPOOL_RETRY_AFTER_MS }
  for (const due of groups.values()) {
    const owner = due[0]!.service!
    const queue = chunkRows(due)
    while (queue.length) {
      const batch = queue.shift()!
      let receipt: { status: number; body: unknown }
      try {
        receipt = await odooServiceUsageJson(event, key, { user_id: owner.user, user_company_id: owner.company, items: batch.map(entry => entry.row) })
      } catch (error) {
        logFailure(`usage report of ${batch.length} rows failed`, error)
        keep([batch, ...queue].flat())
        break
      }
      if (receipt.status === 200) { removeSpooled(batch); continue }
      if (receipt.status === 401 || receipt.status === 403 || receipt.status === 429) {
        logFailure(`usage report of ${batch.length} rows failed with status ${receipt.status}`, new UsageRefused(receipt.status))
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
function retryPending(event: H3Event, key: string): Promise<void> {
  if (key) return chain(SERVICE_CHAIN, () => sendServiceSpooled(event, key))
  const session = sessionKey(event)
  // A request with no session gives the rows no owner to be reported under, so it neither sends nor waits.
  if (!session) return Promise.resolve()
  expireSpooled(Date.now())
  return chain(session, () => sendSpooled(event, session))
}

/** The one chain every service-reported row goes through: the recorder key speaks for all of them, so two reports never overlap. */
const SERVICE_CHAIN = 'service'

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
   * Hands this run's attempts to the process spool once per ledger, in order, then reports what the spool holds. With the
   * deployment's recorder key and the run's user (`run`), the rows are reported as that user by the key, so a session that ended
   * mid-run (logout, an expired cookie, a revoked `ai.use`) no longer loses them; any flush retries every due service row. Without
   * a key (a shared deployment, until its per-tenant key exists) they are reported with the request's session as before: a batch
   * Odoo refuses stays spooled for the next flush of that session, and a run whose request carried no session cookie has no owner
   * for its rows, which are dropped and logged by count, never spooled under an empty key. Every failure to record is logged by
   * class and count, never silently dropped. The call is shielded from the browser (`signal: null`) and runs after the browser
   * stream closed, so a slow or failing report never holds the UI busy.
   *
   * Residual limits, stated rather than hidden: the spool is in memory, so rows Odoo has not yet accepted are lost if this process
   * restarts, and a spooled row is retried only when some later run ends (no timer, because a retry needs a live request for the
   * release and tenant binding) and is given up after the age bound. On a cookie-reported run, a session that ended mid-run is
   * refused with 401/403 and its rows are never sent under another session, because Odoo would bill that session's owner.
   */
  async function flush(event: H3Event, conversationId: string, run?: ReportingRun): Promise<void> {
    if (flushed) return
    flushed = true
    try {
      const rows = records(conversationId)
      const key = run ? recorderKey() : ''
      if (key && run) {
        const owner = { user: positiveId(run.owner.user), company: positiveId(run.company) }
        if (!owner.user || !owner.company) logFailure(`dropped ${rows.length} usage rows of a run with no usable user or company`, new UsageOwnerInvalid())
        else {
          if (rows.length) spoolRows(rows, serviceKeyOf(owner), owner)
          await retryPending(event, key)
        }
        return
      }
      if (rows.length) spoolRows(rows, sessionKey(event))
      await retryPending(event, '')
    } catch (error) {
      // Bookkeeping never touches the user's turn, and this call is the last link of a chain nobody awaits: a request that
      // cannot even name its session is logged, not thrown into an unhandled rejection.
      logFailure('usage report could not be attempted', error)
    }
  }

  return { observe, endStream, flush }
}

export type UsageLedger = ReturnType<typeof createUsageLedger>
