import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { addCadence, riyadhDate } from '@liwan/commercial-contracts'
import { computeQuote } from '@liwan/commercial-contracts/server'
import { transaction } from '../db.js'
import { loadQuoteSources } from './quotes.js'
import { policyWire } from './policies.js'
import { issueInvoiceFromQuote } from './invoices.js'
import { orderView } from './orders.js'
import { CommercialHttpError, digestOf } from './lifecycle.js'
import { createPaymentAttempt, paymentReturnUrls } from './payments.js'
import type { ReturnOrigin } from './return-origin.js'
import { enqueueOutbox } from './outbox.js'
import type { PaymentAdapter } from './payment-adapter.js'
import { holdsTrialAfterLapseSql, owesAtRenewal } from './free-base.js'

const date = (v: any): string => v instanceof Date ? riyadhDate(v) : String(v).slice(0,10)
export function trialEndsAt(days: number, at: Date | string = new Date()): string {
  const instant = new Date(at).getTime()
  if (!Number.isSafeInteger(days) || days < 0 || !Number.isFinite(instant)) throw new Error('invalid_trial')
  return new Date(instant + days * 86_400_000).toISOString()
}

export async function onRenewalPaid(client: PoolClient, order_id: string) {
  const renewal = (await client.query(`SELECT r.* FROM renewals r JOIN orders o ON o.id=r.order_id
    WHERE r.order_id=$1 AND o.payment_state IN ('paid','not_required') AND NOT o.cancelled FOR UPDATE OF r`, [order_id])).rows[0]
  if (!renewal || renewal.status === 'paid') return
  await client.query("UPDATE renewals SET status='paid' WHERE id=$1", [renewal.id])
  // Fulfillment receipt, not payment, advances the applied subscription period. A suspension the vendor ordered stays until the vendor resumes.
  await client.query(`UPDATE subscriptions SET state='active',grace_ends_at=NULL,revision=revision+1
    WHERE id=$1 AND state IN ('active','past_due','suspended') AND (state<>'active' OR grace_ends_at IS NOT NULL) AND NOT manual_suspension`, [renewal.subscription_id])
}

/**
 * Generates every due renewal. Each customer's return origin is resolved before anything is invoiced, so a
 * customer without a usable one is skipped (it is picked up again once fixed) while the rest are processed. The
 * skipped subscription is marked billing-blocked, which the vendor attention list shows until an order is generated
 * for it, and the run then fails with `return_url_forbidden` so the skip is never silent.
 */
export async function generateRenewals(pool: Pool, { now = new Date(), adapter, returnOrigin, subscription_id }: {
  now?: Date; adapter: PaymentAdapter; returnOrigin: ReturnOrigin; subscription_id?: string
}) {
  const today = riyadhDate(now)
  // `has_renewal`: the period already has its renewal (an unpaid invoice may be waiting); nothing is left to generate for it.
  // `owes`: the applied pricing owes something at renewal. A renewal that owes nothing needs no return origin and is never billing-blocked.
  const candidates = (await pool.query(`SELECT s.id,s.customer_id,EXISTS (SELECT 1 FROM renewals r WHERE r.subscription_id=s.id
      AND r.period_start=s.renewal_at AND r.kind='renewal') AS has_renewal,sr.snapshot->'pricing' AS pricing
    FROM subscriptions s JOIN subscription_revisions sr ON sr.id=s.applied_revision_id WHERE s.state IN ('active','past_due')
    AND s.applied_revision_id IS NOT NULL AND s.renewal_at <= $1::date AND ($2::uuid IS NULL OR s.id=$2)
    AND NOT ${holdsTrialAfterLapseSql('s')} ORDER BY s.id`, [today, subscription_id ?? null])).rows
  let unusableOrigins = 0
  const generated: ReturnType<typeof orderView>[] = []
  for (const candidate of candidates) {
    const owes = owesAtRenewal(candidate.pricing)
    let origin = ''
    if (owes) try { origin = await returnOrigin(candidate.customer_id) }
    catch (error) {
      if ((error as { code?: string }).code !== 'return_url_forbidden') throw error
      // A period that already has its renewal blocks nothing, so an outage must not flag it.
      if (candidate.has_renewal) continue
      await pool.query('UPDATE subscriptions SET billing_blocked_at=COALESCE(billing_blocked_at,now()) WHERE id=$1', [candidate.id])
      unusableOrigins++
      continue
    }
    if (candidate.has_renewal) {
      // A usable origin and an existing renewal: nothing is blocked any more, whatever an earlier outage flagged.
      await pool.query('UPDATE subscriptions SET billing_blocked_at=NULL WHERE id=$1 AND billing_blocked_at IS NOT NULL', [candidate.id])
      continue
    }
    const result = await transaction(pool, async client => {
      const sub = (await client.query('SELECT * FROM subscriptions WHERE id=$1 FOR UPDATE', [candidate.id])).rows[0]
      if (!['active','past_due'].includes(sub.state) || !sub.applied_revision_id || !sub.renewal_at || date(sub.renewal_at)>today) return null
      // A lapsed trial still holds its paid snapshot until the lock applies: its renewal is the free base's, and that is
      // generated once the lock is applied. The trial configuration is never invoiced.
      if ((await client.query(`SELECT ${holdsTrialAfterLapseSql('s')} AS held FROM subscriptions s WHERE s.id=$1`, [sub.id])).rows[0].held) return null
      const snapshot = (await client.query('SELECT snapshot FROM subscription_revisions WHERE id=$1', [sub.applied_revision_id])).rows[0].snapshot
      const start = date(sub.renewal_at), end = addCadence(start, snapshot.cadence, 1)
      const renewalId = randomUUID()
      const inserted = await client.query(`INSERT INTO renewals(id,subscription_id,period_start,period_end)
        VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING id`, [renewalId,sub.id,start,end])
      if (!inserted.rowCount) return null
      // Never select a newer plan, bundle, policy or terms revision during renewal.
      const sources = await loadQuoteSources(client, sub.customer_id, snapshot, false)
      if (!snapshot.terms_revision_id) sources.terms = null
      const policy = (await client.query('SELECT * FROM pricing_policy_revisions WHERE id=$1', [snapshot.policy_revision_id])).rows[0]
      if (!policy) throw new Error('pinned_policy_missing')
      sources.policy = policyWire(policy)
      const limits = snapshot.entitlement?.features ?? {}
      const quote = computeQuote({ ...sources,kind:'new',cadence:snapshot.cadence,requested_extra_branches:snapshot.free_base ? Math.min(snapshot.extra_branch_count, sources.plan.included_extra_branches) : snapshot.extra_branch_count,
        // The free base held above its free limits is still free: its quantities are the plan's included ones, never the ceiling it keeps.
        requested_users: snapshot.free_base ? sources.plan.included_users : Number(limits['users.limit'] ?? 0), requested_storage_mb: snapshot.free_base ? sources.plan.included_storage_mb : Number(limits['storage.limit_mb'] ?? 0),
        effective_date:start,period:{start,end},ids:{ id:randomUUID(),customer_id:sub.customer_id,subscription_id:sub.id,expected_subscription_revision:sub.revision },
        expires_at:new Date(now.getTime()+30*60_000).toISOString(),entitlement_digest:snapshot.entitlement.digest })
      await client.query('INSERT INTO commercial_quotes(id,customer_id,payload,digest,expires_at) VALUES($1,$2,$3,$4,$5)', [quote.id,sub.customer_id,JSON.stringify(quote),quote.digest,quote.expires_at])
      const key = `renewal:${sub.id}:${start}`
      const row = (await client.query(`INSERT INTO orders(id,customer_id,subscription_id,kind,quote_id,target_revision_id,expected_applied_revision_id,
        payment_state,fulfillment_state,effective_at,idempotency_key,request_digest,due_now_minor,currency,exponent)
        VALUES($1,$2,$3,'renewal',$4,$5,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [randomUUID(),sub.customer_id,sub.id,quote.id,sub.applied_revision_id,quote.due_now.minor ? 'awaiting_payment':'not_required',
        quote.due_now.minor ? 'not_started':'queued',`${start}T00:00:00+03:00`,key,digestOf({subscription_id:sub.id,period_start:start,quote_digest:quote.digest}),quote.due_now.minor,quote.due_now.currency,quote.due_now.exponent])).rows[0]
      const order = orderView(row)
      const invoice = await issueInvoiceFromQuote(client, {order,quote})
      await client.query('UPDATE renewals SET order_id=$2,invoice_id=$3 WHERE id=$1', [renewalId,order.id,invoice?.id ?? null])
      if (!invoice) {
        await onRenewalPaid(client, order.id)
        await enqueueOutbox(client,{kind:'fulfillment.enqueue',aggregate_id:order.id,dedupe_key:order.target_revision_id,
          payload:{order_id:order.id,subscription_id:sub.id,target_revision_id:order.target_revision_id}})
      }
      // The block ends with the order it was blocking, in the same transaction: a run that fails or finds nothing to
      // generate leaves the flag for the vendor.
      await client.query('UPDATE subscriptions SET billing_blocked_at=NULL WHERE id=$1 AND billing_blocked_at IS NOT NULL', [sub.id])
      return { order,sub,invoice }
    })
    if (!result) continue
    const {order,sub,invoice} = result
    generated.push(order)
    if (!invoice) continue
    // Pricing that owed nothing but produced an invoice anyway still needs its payment page: resolve the origin now.
    if (!owes) {
      try { origin = await returnOrigin(candidate.customer_id) }
      catch (error) {
        if ((error as { code?: string }).code !== 'return_url_forbidden') throw error
        await pool.query('UPDATE subscriptions SET billing_blocked_at=COALESCE(billing_blocked_at,now()) WHERE id=$1', [candidate.id])
        unusableOrigins++
        continue
      }
    }
    let activeToken = false
    if (sub.auto_renew_enabled && sub.auto_renew_consent_at && sub.provider_token_ref) {
      try { activeToken = (await adapter.getToken(sub.provider_token_ref)).active } catch { /* use hosted payment instead */ }
    }
    if (!activeToken) {
      await createPaymentAttempt(pool,{order_id:order.id,customer_id:sub.customer_id,adapter,returnOrigin:async()=>origin})
      continue
    }
    const attemptId = randomUUID()
    await transaction(pool, async client => {
      await client.query(`INSERT INTO payment_attempts(id,order_id,invoice_id,provider,mode,merchant_ref,provider_ref,amount_minor,currency,exponent,token_charge)
        VALUES($1,$2,$3,$4,$5,$2::uuid::text,$2::uuid::text,$6,$7,$8,true)`, [attemptId,order.id,invoice.id,adapter.provider,adapter.mode,invoice.total.minor,invoice.total.currency,invoice.total.exponent])
      await client.query("UPDATE renewals SET status='charging' WHERE order_id=$1", [order.id])
    })
    try {
      const event = await adapter.chargeToken({given_id:order.id,token:sub.provider_token_ref,amount:invoice.total,
        description:`LiwanOS renewal ${order.id}`,callback_url:paymentReturnUrls(origin,attemptId)})
      // A charge response only identifies the attempt; settlement requires provider lookup.
      await pool.query("UPDATE payment_attempts SET provider_ref=$2,status=CASE WHEN status='created' THEN 'pending' ELSE status END,updated_at=now() WHERE id=$1", [attemptId,event.provider_ref])
    } catch {
      await pool.query("UPDATE payment_attempts SET status='unknown',updated_at=now() WHERE id=$1 AND status='created'", [attemptId])
      // The committed invoice/order survive; uncertain charges must be reconciled, never blindly retried.
    }
  }
  if (unusableOrigins) throw new CommercialHttpError('return_url_forbidden', 422)
  return generated
}

export async function applyDunning(pool: Pool, { now = new Date() }: { now?: Date } = {}) {
  return transaction(pool, async client => {
    const rows = (await client.query(`SELECT s.*,sr.snapshot,p.grace_days,p.auto_suspend FROM subscriptions s
      JOIN subscription_revisions sr ON sr.id=s.applied_revision_id
      JOIN plan_revisions p ON p.id=(sr.snapshot->>'plan_revision_id')::uuid
      WHERE s.state IN ('active','past_due') AND NOT ${holdsTrialAfterLapseSql('s')} AND EXISTS (
        SELECT 1 FROM invoices i WHERE i.subscription_id=s.id AND i.status='issued' AND i.due_at < $1)
      ORDER BY s.id FOR UPDATE OF s`, [now])).rows
    const results: { subscription_id: string; state: string }[] = []
    for (const row of rows) {
      // A subscription whose pricing owes nothing is on the free base (or a free plan): an unpaid upgrade invoice never
      // lapses it, because the base stays usable and only the paid applications it asks for stay closed.
      if (!owesAtRenewal(row.snapshot.pricing)) continue
      const due = (await client.query("SELECT min(due_at) AS due_at FROM invoices WHERE subscription_id=$1 AND status='issued' AND due_at<$2", [row.id,now])).rows[0].due_at
      const grace = row.grace_ends_at ?? new Date(new Date(due).getTime()+Number(row.grace_days)*86_400_000)
      const state = row.auto_suspend && new Date(grace).getTime() <= now.getTime() ? 'suspended' : 'past_due'
      if (row.state !== state || !row.grace_ends_at) await client.query('UPDATE subscriptions SET state=$2,grace_ends_at=$3,revision=revision+1 WHERE id=$1', [row.id,state,grace])
      await client.query('UPDATE renewals SET status=$2 WHERE subscription_id=$1 AND status IN (\'invoiced\',\'charging\',\'past_due\')', [row.id,state])
      results.push({subscription_id:row.id,state})
    }
    return results
  })
}
