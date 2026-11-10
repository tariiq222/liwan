import { createHash, randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { acceptQuoteRequestSchema, canonicalJson, quoteRequestSchema, quoteSchema, riyadhDate, type Principal, type Quote } from '@liwan/commercial-contracts'
import { transaction } from '../db.js'
import { CommercialHttpError, digestOf } from './lifecycle.js'
import { acceptQuoteOn, orderView } from './orders.js'
import { buildQuoteOn } from './quotes.js'
import { trialEndsAt } from './renewals.js'
import { endTrialOn } from './trial-expiry.js'
import { generateRenewals } from './renewals.js'
import { paymentAttemptView } from './payments.js'
import type { PaymentAdapter } from './payment-adapter.js'
import type { ReturnOrigin } from './return-origin.js'
import { getSubscription } from './subscriptions.js'
import { reopenTrialOn } from './trial-reopen.js'
import { pushCommercialExpiry } from './expiry-push.js'
export { pushCommercialExpiry } from './expiry-push.js'

/** A customer has one trial, so its order key is fixed per customer (RFC 9562 version 8): a resent start replays it. */
function trialOrderKey(customerId: string) {
  const h = createHash('sha256').update(`trial:${customerId}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-${((parseInt(h[16]!, 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`
}

type TrialInput = { customer_id: string; request: unknown; principal: Principal; now?: Date }

export async function startTrial(pool: Pool, input: TrialInput) {
  const result = await transaction(pool, client => startTrialOn(client, input))
  return { ...result, subscription: await getSubscription(pool, input.customer_id) }
}

/** The trial is a zero-due order. Callers may enroll the customer in this same transaction. */
export async function startTrialOn(client: PoolClient, input: TrialInput) {
  const now = input.now ?? new Date()
  const request = quoteRequestSchema.omit({ subscription_id: true }).parse(input.request)
  const key = trialOrderKey(input.customer_id)
  const digest = digestOf(request)
  const customer = (await client.query('SELECT * FROM customers WHERE id=$1 FOR UPDATE', [input.customer_id])).rows[0]
  if (!customer) throw new CommercialHttpError('not_found', 404)
  // Replay before quoting, including after a tenant or subscription has been provisioned.
  const started = (await client.query('SELECT * FROM orders WHERE customer_id=$1 AND idempotency_key=$2', [input.customer_id, key])).rows[0]
  if (started?.request_digest === digest) return { order: orderView(started), replay: true }
  if (customer.trial_used_at) throw new CommercialHttpError('trial_already_used', 409)
  const existing = (await client.query('SELECT * FROM subscriptions WHERE customer_id=$1 FOR UPDATE', [input.customer_id])).rows[0]
  if (existing?.applied_revision_id) throw new CommercialHttpError('trial_not_available', 409)
  const capability = (await client.query('SELECT post_trial_supported,excess_supported FROM tenants WHERE id=$1', [customer.tenant_id])).rows[0]
  if (customer.tenant_id && (capability?.post_trial_supported !== true || capability?.excess_supported !== true)) throw new CommercialHttpError('tenant_upgrade_required', 409)
  const plan = (await client.query('SELECT trial_days FROM plan_revisions WHERE id=$1 FOR SHARE', [request.plan_revision_id])).rows[0]
  if (!plan) throw new CommercialHttpError('plan_missing', 404)
  if (!plan.trial_days) throw new CommercialHttpError('trial_disabled', 422)
  const built = await buildQuoteOn(client, { customer_id: input.customer_id, request: { ...request, effective_date: riyadhDate(now) } }, now)
  const endsAt = trialEndsAt(plan.trial_days, now)
  const trialQuote = redigest({ ...built, due_now: { ...built.due_now, minor: 0 }, next_renewal_at: riyadhDate(new Date(endsAt)) })
  const acceptInput = acceptQuoteRequestSchema.parse({ quote_id: trialQuote.id, expected_subscription_revision: 0, idempotency_key: key })
  await client.query('INSERT INTO commercial_quotes(id,customer_id,payload,digest,expires_at) VALUES($1,$2,$3,$4,$5)', [trialQuote.id, input.customer_id, JSON.stringify(quoteSchema.parse(trialQuote)), trialQuote.digest, trialQuote.expires_at])
  await client.query('UPDATE customers SET trial_used_at=now() WHERE id=$1', [input.customer_id])
  await client.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)',
    [randomUUID(), input.principal.actor_id, 'trial.started', input.customer_id, `Trial started by ${input.principal.kind}`, JSON.stringify({ plan_revision_id: request.plan_revision_id, trial_days: plan.trial_days })])
  const accepted = await acceptQuoteOn(client, acceptInput, digest, trialQuote, input.principal, now)
  await client.query("UPDATE subscriptions SET state='trialing',trial_ends_at=$2,revision=revision+1 WHERE customer_id=$1", [input.customer_id, endsAt])
  return accepted
}

/** Customer conversion: end the trial now, in one transaction, and return the first invoice's hosted attempt. */
export async function convertTrial(pool: Pool, input: { customer_id: string; now: Date; adapter: PaymentAdapter; returnOrigin: ReturnOrigin }) {
  await input.returnOrigin(input.customer_id) // an unusable origin refuses before any write
  const sub = (await pool.query('SELECT * FROM subscriptions WHERE customer_id=$1', [input.customer_id])).rows[0]
  if (!sub || sub.state !== 'trialing') throw new CommercialHttpError('trial_not_active', 409)
  if (!sub.applied_revision_id) throw new CommercialHttpError('trial_not_applied', 409)
  // The end date and the move out of `trialing` are one commit: the intent to pay is the state itself, so a scheduler run or a
  // crash between the two can never lapse the trial onto the free base and lock what the customer chose to buy.
  const periodStart = await transaction(pool, async client => {
    const ended = await endTrialOn(client, sub.id, { now: input.now, convert: true })
    if (ended === 'deferred') throw new CommercialHttpError('tenant_upgrade_required', 409)
    if (ended !== 'expired') throw new CommercialHttpError('trial_not_active', 409)
    const converted = (await client.query('SELECT renewal_at::text AS period_start,trial_ended_at FROM subscriptions WHERE id=$1', [sub.id])).rows[0]
    await client.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)',
      [randomUUID(), `customer:${input.customer_id}`, 'trial.converted', sub.id, 'Customer converted the trial', JSON.stringify({ converted_at: input.now.toISOString() })])
    await pushCommercialExpiry(client, sub.id, new Date(converted.trial_ended_at).toISOString())
    return converted.period_start as string
  })
  // The first invoice is generated after the commit; a crash before it leaves a past_due subscription the renewal run picks up.
  await generateRenewals(pool, { now: input.now, adapter: input.adapter, returnOrigin: input.returnOrigin, subscription_id: sub.id })
  // The renewal run may also create other due renewals: read this subscription's own first order, never index 0.
  const row = (await pool.query(`SELECT o.* FROM orders o JOIN renewals r ON r.order_id=o.id
    WHERE r.subscription_id=$1 AND r.period_start=$2 AND r.kind='renewal' AND r.status<>'superseded' AND NOT o.cancelled
    LIMIT 1`, [sub.id, periodStart])).rows[0]
  const order = row ? orderView(row) : null
  const attempt = order ? (await pool.query('SELECT * FROM payment_attempts WHERE order_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1', [order.id])).rows[0] : null
  return { order, attempt: attempt ? paymentAttemptView(attempt) : null, pending: !order }
}

/** Vendor-only trial controls; each write is audited and only applies to a trialing subscription. */
export async function extendTrial(pool: Pool, input: { subscription_id: string; days: number; reason: string; actor: string; now?: Date }) {
  const now = input.now ?? new Date()
  return transaction(pool, async client => {
    const sub = (await client.query('SELECT * FROM subscriptions WHERE id=$1 FOR UPDATE', [input.subscription_id])).rows[0]
    if (!sub) throw new CommercialHttpError('trial_not_active', 409)
    if (sub.state !== 'trialing' || (sub.applied_revision_id && sub.trial_ends_at && new Date(sub.trial_ends_at) <= now)) {
      return reopenTrialOn(client, sub, { ...input, now, endsAt: new Date(trialEndsAt(input.days, now)) })
    }
    const trialPolicyPending = sub.target_revision_id && (await client.query(`SELECT 1 FROM orders WHERE target_revision_id=$1
      AND (idempotency_key LIKE 'trial-reopen:%' OR idempotency_key LIKE 'trial-bootstrap:%') AND NOT cancelled`, [sub.target_revision_id])).rowCount
    if (trialPolicyPending) throw new CommercialHttpError('subscription_change_pending', 409)
    const updated = await client.query(`UPDATE subscriptions SET trial_ends_at=GREATEST(trial_ends_at,$3::timestamptz)+($2||' days')::interval,revision=revision+1
      WHERE id=$1 AND state='trialing' AND trial_ends_at IS NOT NULL RETURNING customer_id,trial_ends_at`, [input.subscription_id, String(input.days), now])
    if (!updated.rowCount) throw new CommercialHttpError('trial_not_active', 409)
    await client.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)',
      [randomUUID(), input.actor, 'trial.extended', input.subscription_id, input.reason, JSON.stringify({ days: input.days })])
    await pushCommercialExpiry(client, input.subscription_id, updated.rows[0].trial_ends_at)
    return { customer_id: updated.rows[0].customer_id as string, trial_ends_at: updated.rows[0].trial_ends_at }
  })
}

export async function endTrial(pool: Pool, input: { subscription_id: string; reason: string; actor: string; now: Date }) {
  const owner = (await pool.query('SELECT customer_id,state,applied_revision_id FROM subscriptions WHERE id=$1', [input.subscription_id])).rows[0]
  if (!owner || owner.state !== 'trialing') throw new CommercialHttpError('trial_not_active', 409)
  // The first invoice is built from the applied snapshot: ending a trial whose workspace is not active yet would leave a past-due subscription with nothing to pay.
  if (!owner.applied_revision_id) throw new CommercialHttpError('trial_not_applied', 409)
  await transaction(pool, async client => {
    const ended = await endTrialOn(client, input.subscription_id, { now: input.now, convert: false, early: true })
    if (ended === 'deferred') throw new CommercialHttpError('tenant_upgrade_required', 409)
    if (ended !== 'lapsed') throw new CommercialHttpError('trial_not_active', 409)
    await client.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)',
      [randomUUID(), input.actor, 'trial.ended', input.subscription_id, input.reason, JSON.stringify({ ended_at: input.now.toISOString() })])
  })
  return { customer_id: owner.customer_id as string }
}

/** Recompute the digest after changing only the trial amount and the first renewal date. */
function redigest(quote: Quote): Quote {
  const { id: _id, digest: _digest, ...body } = quote
  return { ...quote, digest: createHash('sha256').update(canonicalJson({ kind: 'new', ...body })).digest('hex') }
}
