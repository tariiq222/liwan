import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { riyadhDate } from '@liwan/commercial-contracts'
import { transaction, transactionOn } from '../db.js'
import { CommercialHttpError } from './lifecycle.js'
import { applyConfirmedEvent, closeOtherAttempts, paymentReturnUrls } from './payments.js'
import { PaymentError, type PaymentAdapter, type ProviderEvent } from './payment-adapter.js'
import { timelyRenewalNoticeSql } from './renewal-notices.js'
import { openMethodToken } from './payment-method-crypto.js'
import { markStoredMethodInvalid, storedMethodLockKey, type StoredMethodRuntime } from './payment-methods.js'
import type { ReturnOrigin } from './return-origin.js'
import { STORED_CHARGE_UNSENT_MS, STORED_CHARGE_UNRESOLVED_MS } from './charge-timings.js'

type Query = Pick<PoolClient, 'query'>
type StoredAttempt = {
  id: string; order_id: string; provider: string; provider_ref: string | null; mode: string
  status: string; collection_date: string; created_at: Date; sent_at: Date | null; amount_minor: string; currency: string; exponent: number
}
type CloseReason = 'token_inactive' | 'unsent_expired' | 'abandoned' | 'refused' | 'superseded' | 'provider_closed' | 'declined'
type MethodIdentity = { id: string; subscription_id: string; provider: string }
type OpenToken = (ciphertext: Buffer, keyId: string, method: MethodIdentity) => Promise<string> | string
type ClaimConnection = { client: PoolClient; expected: { method_id: string; key_id: string; token_ciphertext: Buffer } }

const live = (status: string) => ['created', 'unknown', 'pending'].includes(status)

export function storedChargeDeadline(attempt: Pick<StoredAttempt, 'status' | 'collection_date' | 'created_at' | 'sent_at'>) {
  if (attempt.status !== 'created') return new Date(new Date(attempt.sent_at!).getTime() + STORED_CHARGE_UNRESOLVED_MS)
  const nextMidnight = Date.parse(`${attempt.collection_date}T00:00:00+03:00`) + 86_400_000
  return new Date(Math.min(nextMidnight, new Date(attempt.created_at).getTime() + STORED_CHARGE_UNSENT_MS))
}

export function storedChargeInProgress(attempt: StoredAttempt) {
  return new CommercialHttpError('payment_charge_in_progress', 409, undefined, [], { resolve_by: storedChargeDeadline(attempt).toISOString() })
}

export function closeStoredCharge(client: Query, id: string, reason: CloseReason, status?: string, providerRef?: string) {
  return client.query(`UPDATE payment_attempts SET status=$2,closed_reason=$3,provider_ref=COALESCE(provider_ref,$5),resolved_at=now(),updated_at=now()
    WHERE id=$1 AND token_charge AND status IN ('created','unknown','pending')
      AND ($4::text IS NULL OR status=$4)`, [id, reason === 'declined' ? 'failed' : 'canceled', reason, status ?? null, providerRef ?? null])
}

/** Called under the order lock. No provider reads or sends are needed to release a stale hold. */
export async function expireStoredCharge(client: PoolClient, attempt: StoredAttempt, now: Date) {
  if (!live(attempt.status) || storedChargeDeadline(attempt) > now) return false
  const reason = attempt.status === 'created' ? 'unsent_expired' : 'abandoned'
  const result = await closeStoredCharge(client, attempt.id, reason, attempt.status)
  if (result.rowCount && reason === 'abandoned') await client.query(
    `INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES($1,'system','payment.token_charge_abandoned',$2,$3,$4)`,
    [randomUUID(), attempt.order_id, 'Stored-method outcome did not resolve within the payment window', JSON.stringify({ attempt_id: attempt.id })],
  )
  return Boolean(result.rowCount)
}

async function withStoredOrder<T>(pool: Pool, attemptId: string, work: (client: PoolClient) => Promise<T>, connection?: PoolClient) {
  const action = async (client: PoolClient) => {
    const found = (await client.query('SELECT order_id FROM payment_attempts WHERE id=$1 AND token_charge', [attemptId])).rows[0]
    if (!found) return null
    await client.query('SELECT id FROM orders WHERE id=$1 FOR UPDATE', [found.order_id])
    return work(client)
  }
  return connection ? transactionOn(connection,action) : transaction(pool,action)
}

/** The only transition that authorizes a provider send. Its commit precedes the call. */
export async function claimForSend(pool: Pool, attemptId: string, clock = Date.now, connection?: ClaimConnection) {
  return withStoredOrder(pool, attemptId, async client => {
    const row = (await client.query(`SELECT a.*,n.renewal_date::text AS collection_date,m.token_ciphertext,m.key_id
      FROM payment_attempts a JOIN payment_methods m ON m.id=a.method_id
      JOIN orders o ON o.id=a.order_id JOIN invoices i ON i.id=a.invoice_id
      JOIN subscriptions s ON s.id=o.subscription_id
      JOIN subscription_revisions sr ON sr.id=o.target_revision_id
      JOIN renewal_notices n ON n.id=a.notice_id AND n.method_id=m.id
      WHERE a.id=$1 AND a.token_charge AND a.status='created'
        AND m.subscription_id=s.id AND m.provider=a.provider AND m.state='active'
        AND o.kind='renewal' AND o.payment_state='awaiting_payment' AND NOT o.cancelled AND NOT s.manual_suspension
        AND i.order_id=o.id AND i.status='issued' AND i.total_minor=a.amount_minor
        AND i.currency=a.currency AND i.exponent=a.exponent
        AND n.renewal_date=i.period_start AND ${timelyRenewalNoticeSql}
        AND (n.amount_minor,n.currency,n.exponent)=(i.total_minor,i.currency,i.exponent)
        AND n.cadence_unit=sr.snapshot#>>'{cadence,unit}'
        AND n.cadence_count::text=sr.snapshot#>>'{cadence,count}'
      FOR UPDATE OF a FOR SHARE OF m,n`, [attemptId])).rows[0]
    if (!row) return null
    const expected = connection?.expected
    if (expected && (row.method_id !== expected.method_id || row.key_id !== expected.key_id || !row.token_ciphertext.equals(expected.token_ciphertext))) return null
    // Both locks can block. Measure the unsent window at the actual dispatch fence.
    const claimedAt = new Date(clock())
    if (riyadhDate(claimedAt) !== row.collection_date || storedChargeDeadline(row) <= claimedAt) return null
    const claimed = await client.query(`UPDATE payment_attempts SET status='unknown',sent_at=$2,updated_at=$2
      WHERE id=$1 AND status='created'`, [attemptId,claimedAt])
    return claimed.rowCount ? { ...row, sent_at: claimedAt } as StoredAttempt : null
  }, connection?.client)
}

function matchesStoredCharge(row: StoredAttempt, event: ProviderEvent, adapter: PaymentAdapter, lookupRef: string) {
  return event.provider === row.provider && event.provider === adapter.provider
    && event.merchant_account === adapter.merchantAccount && event.live === (row.mode === 'live')
    && Boolean(event.provider_ref) && event.provider_ref === lookupRef && (!event.attempt_id || event.attempt_id === row.id)
    && (!row.provider_ref || row.provider_ref === event.provider_ref)
    && (row.provider_ref !== null || event.attempt_id === row.id || event.provider_ref === row.id)
    && event.amount.minor === Number(row.amount_minor) && event.amount.currency === row.currency && event.amount.exponent === row.exponent
}

async function pinStoredReference(pool: Pool, attemptId: string, ref: string) {
  return withStoredOrder(pool, attemptId, client => client.query(`UPDATE payment_attempts
    SET status='pending',provider_ref=$2,updated_at=now()
    WHERE id=$1 AND status='unknown' AND provider_ref IS NULL`, [attemptId,ref]))
}

/** Confirm with a read. A missing or mismatched lookup never authorizes a send. */
async function recordOutcome(pool: Pool, adapter: PaymentAdapter, row: StoredAttempt) {
  const ref = row.provider_ref ?? row.id
  let event: ProviderEvent | undefined
  try { event = await adapter.lookupPayment?.(ref) }
  catch (error) {
    if (error instanceof PaymentError) return
    throw error
  }
  if (!event || !matchesStoredCharge(row, event, adapter, ref)) return
  const confirmed = { ...event, attempt_id: row.id }
  if (await applyConfirmedEvent(pool, confirmed) === 'accepted' && confirmed.status === 'succeeded')
    await closeOtherAttempts(pool, adapter, confirmed)
}

type Invocation = { response: ProviderEvent } | { error: unknown }

async function beginDispatch(pool: Pool, input: {
  adapter: PaymentAdapter; attemptId: string; clock: () => number; callbackUrl: string; token: string
  method: MethodIdentity; expected: ClaimConnection['expected']
}) {
  const client = await pool.connect()
  const lock = storedMethodLockKey(input.method.subscription_id)
  let held = false, discard = false
  try {
    await client.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [lock])
    held = true
    const row = await claimForSend(pool,input.attemptId,input.clock,{ client, expected: input.expected })
    if (!row) return null
    if (riyadhDate(new Date(input.clock())) !== row.collection_date) {
      // The day changed after the claim committed but before invoking the provider.
      await withStoredOrder(pool,row.id,db => db.query(`UPDATE payment_attempts
        SET status='canceled',closed_reason='unsent_expired',sent_at=NULL,resolved_at=now(),updated_at=now()
        WHERE id=$1 AND token_charge AND status='unknown' AND sent_at=$2 AND provider_ref IS NULL`, [row.id,row.sent_at]),client)
      return null
    }
    let outcome: Promise<Invocation>
    try {
      // This synchronous start and off are ordered by the same session fence.
      // Do not return the bare promise: off may run while its outcome is pending.
      outcome = input.adapter.chargeToken({ attempt_id: row.id, token: input.token,
        amount: { minor: Number(row.amount_minor), currency: row.currency, exponent: row.exponent },
        description: `LiwanOS order ${row.order_id}`, callback_url: input.callbackUrl,
      }).then(response => ({ response }), error => ({ error }))
    } catch (error) { outcome = Promise.resolve({ error }) }
    return { row, outcome }
  } finally {
    if (held) {
      try { await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [lock]) }
      catch { discard = true }
    }
    client.release(discard)
  }
}

/** The only stored-method dispatch entry point. Real providers remain disabled. */
export async function sendTokenCharge(pool: Pool, input: {
  attemptId: string; adapter: PaymentAdapter; openToken: OpenToken; callbackUrl: string; clock?: () => number
  onInactive?: (method: MethodIdentity, keyId: string, now: Date) => Promise<void>
}) {
  const { adapter } = input
  if (adapter.mode !== 'simulator') return false
  const clock = input.clock ?? Date.now
  const existing = (await pool.query(`SELECT a.*,m.subscription_id,m.token_ciphertext,m.key_id
    FROM payment_attempts a JOIN payment_methods m ON m.id=a.method_id
    WHERE a.id=$1 AND a.token_charge AND a.status='created' AND m.state='active'`, [input.attemptId])).rows[0]
  if (!existing || existing.provider !== adapter.provider || existing.mode !== adapter.mode) return false
  const method = { id: existing.method_id, subscription_id: existing.subscription_id, provider: existing.provider }
  let token: string
  try { token = await input.openToken(existing.token_ciphertext, existing.key_id, method) } catch { return false }
  let active: boolean
  try { active = (await adapter.getToken(token)).active }
  catch (error) {
    if (!(error instanceof PaymentError) || error.code !== 'not_found') return false
    active = false
  }
  if (!active) {
    await input.onInactive?.(method,existing.key_id,new Date(clock()))
    await withStoredOrder(pool,input.attemptId,client => closeStoredCharge(client,input.attemptId,'token_inactive','created'))
    return false
  }
  const dispatch = await beginDispatch(pool,{ adapter, attemptId: input.attemptId, clock, callbackUrl: input.callbackUrl,
    token, method, expected: existing })
  if (!dispatch) return false
  const { row } = dispatch
  const outcome = await dispatch.outcome
  if ('error' in outcome) {
    const { error } = outcome
    if (error instanceof PaymentError && error.httpStatus !== undefined && error.httpStatus >= 400 && error.httpStatus < 500)
      await withStoredOrder(pool,row.id,client => closeStoredCharge(client,row.id,'refused','unknown'))
    return true
  }
  const { response } = outcome
  if (matchesStoredCharge(row,response,adapter,response.provider_ref)) {
    await pinStoredReference(pool,row.id,response.provider_ref)
    await recordOutcome(pool,adapter,{ ...row, provider_ref: response.provider_ref })
  }
  return true
}

export async function sendReservedStoredCharges(pool: Pool, input: {
  runtime: StoredMethodRuntime; returnOrigin: ReturnOrigin; clock?: () => number; signal?: AbortSignal
}) {
  const { adapter,key } = input.runtime
  if (adapter.mode !== 'simulator' || !adapter.storedMethods) return 0
  const rows = (await pool.query(`SELECT a.id,o.customer_id FROM payment_attempts a JOIN orders o ON o.id=a.order_id
    JOIN payment_methods m ON m.id=a.method_id WHERE a.token_charge AND a.status='created' AND m.state='active'
      AND a.provider=$1 AND a.mode='simulator' AND m.key_id=$2 ORDER BY a.created_at,a.id LIMIT 20`, [adapter.provider,key.id])).rows
  let sent = 0
  for (const { id,customer_id } of rows) {
    if (input.signal?.aborted) break
    try {
      const callbackUrl = paymentReturnUrls(await input.returnOrigin(customer_id),id)
      if (await sendTokenCharge(pool,{ attemptId: id,adapter,callbackUrl,clock: input.clock,
        openToken: (ciphertext,keyId,method) => openMethodToken(key,{ ...method, key_id: keyId, token_ciphertext: ciphertext }),
        onInactive: (method,keyId,now) => markStoredMethodInvalid(pool,method.id,keyId,now),
      })) sent++
    } catch (error) {
      console.error(`[stored-charge] dispatch ${id} deferred: ${error instanceof Error ? error.name : 'error'}`)
    }
  }
  return sent
}

export async function reconcileTokenCharges(pool: Pool, adapter: PaymentAdapter, now = new Date()) {
  const rows: StoredAttempt[] = (await pool.query(`WITH due AS (
    SELECT id FROM payment_attempts WHERE token_charge AND status IN ('created','unknown','pending')
      AND provider=$1 AND mode=$2 ORDER BY updated_at,id LIMIT 20 FOR UPDATE SKIP LOCKED
  ) UPDATE payment_attempts a SET updated_at=$3 FROM due WHERE a.id=due.id RETURNING a.*`, [adapter.provider, adapter.mode, now])).rows
  for (const row of rows) {
    const expired = await withStoredOrder(pool, row.id, async client => {
      const current = (await client.query(`SELECT a.*,i.period_start::text AS collection_date FROM payment_attempts a
        JOIN invoices i ON i.id=a.invoice_id WHERE a.id=$1 FOR UPDATE OF a`, [row.id])).rows[0]
      return current && await expireStoredCharge(client, current, now)
    })
    if (expired || row.status === 'created') continue
    try { await recordOutcome(pool, adapter, row) } catch { /* an unresolved read is retried until the clock bound */ }
  }
}

/** A live stored charge suppresses billing enforcement while the customer cannot use hosted payment. */
export const overdueInvoiceSql = (invoice: string, at = 'now()') => `${invoice}.status='issued' AND ${invoice}.due_at<${at}
  AND NOT EXISTS (SELECT 1 FROM payment_attempts charge WHERE charge.invoice_id=${invoice}.id
    AND charge.token_charge AND charge.status IN ('created','unknown','pending'))`

/** The status reader exposes timing, never a token, key id or provider payment URL. */
export async function getStoredChargeCollection(client: Query, orderId: string, now = new Date()) {
  const row: StoredAttempt | undefined = (await client.query(`SELECT a.id,a.status,a.sent_at,a.created_at,i.period_start::text AS collection_date
    FROM payment_attempts a JOIN invoices i ON i.id=a.invoice_id
    WHERE a.order_id=$1 AND a.token_charge
    ORDER BY (a.status IN ('created','unknown','pending')) DESC,a.created_at DESC,a.id DESC LIMIT 1`, [orderId])).rows[0]
  if (!row) return undefined
  if (live(row.status) && storedChargeDeadline(row) > now)
    return { state: 'in_progress' as const, resolve_by: storedChargeDeadline(row).toISOString() }
  return { state: row.status === 'failed' ? 'declined' as const : 'closed' as const, resolve_by: null }
}
