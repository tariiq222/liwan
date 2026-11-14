import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { TENANT_DELETION_WINDOW_DAYS, type TenantDeletion } from '@liwan/commercial-contracts'
import { transaction } from '../db.js'
import { CommercialHttpError } from './lifecycle.js'
import { cancelRefusal } from './cancellation-rules.js'
import { cancelRenewalOn } from './cancellation.js'
import { disableAutoRenew } from './auto-renew.js'
import { enqueueOutbox } from './outbox.js'
import { OPEN_DELETION_STATES, tenantDeletionOf } from './tenant-deletion-read.js'

export const TENANT_DELETION_NOTICE_KIND = 'tenant_deletion.notice'
/** The emailed code works this long, for this many wrong tries, and once. */
export const DELETION_CODE_TTL_MINUTES = 15
export const DELETION_CODE_MAX_ATTEMPTS = 5
/** A new code to one customer: not within a minute of the last, and at most five an hour, however many requests carried them. */
export const DELETION_CODE_COOLDOWN_SECONDS = 60
export const DELETION_CODE_HOURLY_LIMIT = 5
export const DELETION_SYSTEM_ACTOR = 'system:tenant-deletion'

export type DeletionNoticeType = 'requested' | 'confirmed' | 'reminder' | 'withdrawn' | 'due'
export type DeletionNoticePayload = { type: DeletionNoticeType; request_id: string; seq?: number; days?: number; code?: string }
type Row = Record<string, any> & { id: string; customer_id: string; state: string }
type Who = { actor: string; client_address: string | null }

/** One lock per customer serializes every request, confirmation, withdrawal and the due pass, so two managers cannot race. Held to commit. */
const lockCustomerDeletion = (client: PoolClient, customerId: string) => client.query(`SELECT pg_advisory_xact_lock(hashtextextended('tenant-deletion:' || $1::text, 0))`, [customerId])

async function audited(client: PoolClient, who: Who, action: string, customerId: string, reason: string, metadata: Record<string, unknown>) {
  await client.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)',
    [randomUUID(), who.actor, action, customerId, reason, JSON.stringify({ ...metadata, client_address: who.client_address })])
}

const openRequest = async (client: Pick<PoolClient, 'query'>, customerId: string): Promise<Row | undefined> =>
  (await client.query(`SELECT *,(code_expires_at <= now()) AS code_expired FROM tenant_deletion_requests WHERE customer_id=$1 AND state=ANY($2::text[]) FOR UPDATE`, [customerId, OPEN_DELETION_STATES])).rows[0]

const codeDigest = (secret: string, requestId: string, seq: number, code: string) =>
  createHmac('sha256', secret).update(JSON.stringify(['tenant-deletion', requestId, seq, code])).digest()

/** Every time in this module is the database clock (`now()`), never the process clock: a wrong application clock cannot start, shorten or end a window. */
async function assertCodeBudget(client: PoolClient, customerId: string) {
  const used = (await client.query(`SELECT count(*) FILTER (WHERE created_at > now() - interval '1 hour')::int AS hourly,
      count(*) FILTER (WHERE created_at > now() - make_interval(secs => $2))::int AS cooling
    FROM audit_events WHERE action='tenant_deletion.code_sent' AND subject=$1`, [customerId, DELETION_CODE_COOLDOWN_SECONDS])).rows[0]
  if (used.hourly >= DELETION_CODE_HOURLY_LIMIT || used.cooling > 0) throw new CommercialHttpError('rate_limited', 429)
}

/**
 * Step 1: opens the request (or sends a fresh code for the one still waiting) and mails the code to the address on record of the
 * customer's first manager, never to an address from the request. Nothing is deleted and no clock starts. A request that already
 * has its clock running (confirmed or due) is refused with `deletion_pending`.
 */
export async function requestDeletion(pool: Pool, input: Who & { customer_id: string; secret: string }): Promise<TenantDeletion> {
  await transaction(pool, async client => {
    await lockCustomerDeletion(client, input.customer_id)
    const customer = (await client.query('SELECT admin_login,tenant_id FROM customers WHERE id=$1', [input.customer_id])).rows[0]
    if (!customer) throw new CommercialHttpError('not_found', 404)
    if (!customer.tenant_id) throw new CommercialHttpError('no_workspace', 409)
    if (!customer.admin_login) throw new CommercialHttpError('no_manager_address', 409)
    const open = await openRequest(client, input.customer_id)
    if (open && open.state !== 'requested') throw new CommercialHttpError('deletion_pending', 409)
    await assertCodeBudget(client, input.customer_id)
    const id = open?.id ?? randomUUID()
    const seq = (open?.code_seq ?? 0) + 1
    const code = String(randomInt(1_000_000)).padStart(6, '0')
    const digest = codeDigest(input.secret, id, seq, code)
    if (open) await client.query(`UPDATE tenant_deletion_requests SET code_seq=$2,code_hash=$3,code_expires_at=now() + make_interval(mins => $4),code_attempts=0,revision=revision+1 WHERE id=$1`,
      [id, seq, digest, DELETION_CODE_TTL_MINUTES])
    else {
      await client.query(`INSERT INTO tenant_deletion_requests(id,customer_id,state,requested_at,requested_by,requested_from,code_seq,code_hash,code_expires_at)
        VALUES($1,$2,'requested',now(),$3,$4,$5,$6,now() + make_interval(mins => $7))`, [id, input.customer_id, input.actor, input.client_address, seq, digest, DELETION_CODE_TTL_MINUTES])
      await audited(client, input, 'tenant_deletion.requested', input.customer_id, '', { request_id: id })
    }
    await audited(client, input, 'tenant_deletion.code_sent', input.customer_id, '', { request_id: id, seq })
    // The code travels to the mailer in the outbox payload only until it is sent or expires, then it is scrubbed.
    await enqueueOutbox(client, { kind: TENANT_DELETION_NOTICE_KIND, aggregate_id: id, dedupe_key: `requested:${id}:${seq}`,
      payload: { type: 'requested', request_id: id, seq, code } satisfies DeletionNoticePayload })
  })
  return (await tenantDeletionOf(pool, input.customer_id))!
}

/**
 * Inside the caller's transaction: kills the emailed code of a request still waiting for it, because the address it went to is no longer
 * the address on record. The request stays open; asking again sends a new code to the new address. Returns whether a live code was killed.
 */
export async function invalidateDeletionCode(client: PoolClient, who: Who, customerId: string, reason: string): Promise<boolean> {
  await lockCustomerDeletion(client, customerId)
  const killed = (await client.query(`UPDATE tenant_deletion_requests SET code_hash=NULL,code_expires_at=NULL,revision=revision+1
    WHERE customer_id=$1 AND state='requested' AND code_hash IS NOT NULL RETURNING id`, [customerId])).rows[0]
  if (killed) await audited(client, who, 'tenant_deletion.code_invalidated', customerId, reason, { request_id: killed.id })
  return !!killed
}

type Confirmation = { ok: true } | { ok: false; code: 'invalid_code' | 'company_name_mismatch' }

/**
 * Step 2: the emailed code and the exact company name start the clock: the request is `due` `TENANT_DELETION_WINDOW_DAYS` days later.
 * A wrong, expired, used or exhausted code is always `invalid_code` (nothing more is said); a wrong try is counted even though the
 * answer is a refusal. Confirming also stops the paid renewal when the subscription can be cancelled (no refund) and records what
 * happened to it.
 */
export async function confirmDeletion(pool: Pool, input: Who & { customer_id: string; code: string; company_name: string; secret: string }): Promise<TenantDeletion> {
  const outcome = await transaction<Confirmation>(pool, async client => {
    await lockCustomerDeletion(client, input.customer_id)
    const open = await openRequest(client, input.customer_id)
    if (!open || open.state !== 'requested' || !open.code_hash || open.code_expired || open.code_attempts >= DELETION_CODE_MAX_ATTEMPTS)
      return { ok: false, code: 'invalid_code' }
    if (!timingSafeEqual(open.code_hash, codeDigest(input.secret, open.id, open.code_seq, input.code))) {
      await client.query('UPDATE tenant_deletion_requests SET code_attempts=code_attempts+1,revision=revision+1 WHERE id=$1', [open.id])
      return { ok: false, code: 'invalid_code' }
    }
    const customer = (await client.query('SELECT name FROM customers WHERE id=$1', [input.customer_id])).rows[0]
    if (input.company_name.normalize('NFC') !== String(customer.name).normalize('NFC')) return { ok: false, code: 'company_name_mismatch' }
    const renewal = await stopRenewal(client, input, open.id)
    const confirmed = (await client.query(`UPDATE tenant_deletion_requests SET state='confirmed',code_hash=NULL,code_expires_at=NULL,confirmed_at=now(),confirmed_by=$2,confirmed_from=$3,
      due_at=now() + make_interval(days => $4),renewal_outcome=$5,renewal_refusal=$6,revision=revision+1 WHERE id=$1 RETURNING due_at`,
    [open.id, input.actor, input.client_address, TENANT_DELETION_WINDOW_DAYS, renewal.outcome, renewal.refusal])).rows[0]
    await audited(client, input, 'tenant_deletion.confirmed', input.customer_id, '', { request_id: open.id, due_at: confirmed.due_at.toISOString(), renewal_outcome: renewal.outcome, renewal_refusal: renewal.refusal })
    await enqueueOutbox(client, { kind: TENANT_DELETION_NOTICE_KIND, aggregate_id: open.id, dedupe_key: `confirmed:${open.id}`,
      payload: { type: 'confirmed', request_id: open.id } satisfies DeletionNoticePayload })
    return { ok: true }
  })
  if (!outcome.ok) throw new CommercialHttpError(outcome.code, 422)
  return (await tenantDeletionOf(pool, input.customer_id))!
}

/** Stops the renewal at the period end through the cancellation path when the subscription can be cancelled; otherwise the deletion goes on and the reason is kept. */
async function stopRenewal(client: PoolClient, input: Who & { customer_id: string }, requestId: string): Promise<{ outcome: 'cancelled' | 'already_cancelled' | 'not_cancellable'; refusal: string | null }> {
  const sub = (await client.query('SELECT *,renewal_at::text AS renewal_on FROM subscriptions WHERE customer_id=$1 FOR UPDATE', [input.customer_id])).rows[0]
  if (!sub) return { outcome: 'not_cancellable', refusal: 'no_subscription' }
  // A confirmed deletion ends every automatic charge, whether or not the renewal can also be cancelled (the card record stays).
  await disableAutoRenew(client, sub.id, { actor: input.actor, reason: `Workspace deletion confirmed (request ${requestId})` })
  if (sub.cancel_requested_at) return { outcome: 'already_cancelled', refusal: null }
  const refusal = await cancelRefusal(client, sub)
  if (refusal) return { outcome: 'not_cancellable', refusal }
  const now = (await client.query('SELECT now() AS now')).rows[0].now as Date
  await cancelRenewalOn(client, sub, { by: 'customer', actor: input.actor, reason: `Workspace deletion confirmed (request ${requestId})`, now, notify: false })
  return { outcome: 'cancelled', refusal: null }
}

/**
 * Withdraws the open request, by a holder of `tenant.delete` or the vendor, any time before it is `due`. No code is needed: withdrawing is
 * the safe direction. It never resumes a renewal the deletion stopped. Asking again with no open request changes nothing; a due request is refused.
 */
export async function withdrawDeletion(pool: Pool, input: Who & { customer_id: string; by: 'customer' | 'vendor'; reason: string | null }): Promise<void> {
  await transaction(pool, async client => {
    await lockCustomerDeletion(client, input.customer_id)
    const open = await openRequest(client, input.customer_id)
    if (!open) return
    if (open.state === 'due') throw new CommercialHttpError('deletion_due', 409)
    await client.query(`UPDATE tenant_deletion_requests SET state='withdrawn',code_hash=NULL,code_expires_at=NULL,withdrawn_at=now(),withdrawn_by=$2,withdrawn_actor=$3,withdrawn_from=$4,withdraw_reason=$5,revision=revision+1 WHERE id=$1`,
      [open.id, input.by, input.actor, input.client_address, input.reason])
    await audited(client, input, 'tenant_deletion.withdrawn', input.customer_id, input.reason ?? '', { request_id: open.id, by: input.by, was: open.state })
    await enqueueOutbox(client, { kind: TENANT_DELETION_NOTICE_KIND, aggregate_id: open.id, dedupe_key: `withdrawn:${open.id}`,
      payload: { type: 'withdrawn', request_id: open.id } satisfies DeletionNoticePayload })
  })
}

/**
 * Moves every confirmed request whose window has ended (by the database clock) to `due`, once each. It stops there: nothing is dropped and the
 * tenant is untouched; the vendor sees the request in the attention list until a later stage carries the deletion out. Returns the number moved.
 */
export async function markDueDeletions(pool: Pool): Promise<number> {
  const ids = (await pool.query(`SELECT customer_id FROM tenant_deletion_requests WHERE state='confirmed' AND due_at <= now() ORDER BY due_at,id LIMIT 100`)).rows as { customer_id: string }[]
  let moved = 0
  for (const { customer_id } of ids) {
    moved += await transaction(pool, async client => {
      await lockCustomerDeletion(client, customer_id)
      const row = (await client.query(`UPDATE tenant_deletion_requests SET state='due',due_marked_at=now(),revision=revision+1 WHERE customer_id=$1 AND state='confirmed' AND due_at <= now() RETURNING id,due_at`, [customer_id])).rows[0]
      if (!row) return 0
      await audited(client, { actor: DELETION_SYSTEM_ACTOR, client_address: null }, 'tenant_deletion.due', customer_id, '', { request_id: row.id, due_at: row.due_at.toISOString() })
      await enqueueOutbox(client, { kind: TENANT_DELETION_NOTICE_KIND, aggregate_id: row.id, dedupe_key: `due:${row.id}`, payload: { type: 'due', request_id: row.id } satisfies DeletionNoticePayload })
      return 1
    })
  }
  return moved
}

/**
 * A code that has expired is dead whatever the mail state: its request row forgets the hash and the attempts, and a queued code mail that has not gone out
 * (the mailer keeps failing) is scrubbed of the code and closed as failed, so no plaintext code outlives its 15 minutes. Returns the mails closed.
 */
export async function expireDeletionCodes(pool: Pool): Promise<number> {
  await pool.query(`UPDATE tenant_deletion_requests SET code_hash=NULL,code_expires_at=NULL,code_attempts=0,revision=revision+1 WHERE state='requested' AND code_expires_at <= now()`)
  const closed = await pool.query(`UPDATE commercial_outbox o SET status='failed',processed_at=now(),payload=(payload - 'code') || '{"error":"code_expired"}'::jsonb
    WHERE o.kind=$1 AND o.status='pending' AND o.payload->>'type'='requested' AND o.payload ? 'code'
      AND NOT EXISTS (SELECT 1 FROM tenant_deletion_requests r WHERE r.id::text=o.aggregate_id AND r.state='requested' AND r.code_seq=(o.payload->>'seq')::int
        AND r.code_expires_at > now())`, [TENANT_DELETION_NOTICE_KIND])
  return closed.rowCount ?? 0
}
