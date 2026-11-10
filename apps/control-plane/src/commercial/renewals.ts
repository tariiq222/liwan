import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { addCadence, riyadhDate } from '@liwan/commercial-contracts'
import { computeQuote } from '@liwan/commercial-contracts/server'
import { transaction } from '../db.js'
import { loadQuoteSources, pricingOf } from './quote-sources.js'
import { policyWire } from './policies.js'
import { issueInvoiceFromQuote } from './invoices.js'
import { orderView } from './orders.js'
import { CommercialHttpError, digestOf } from './lifecycle.js'
import { createPaymentAttempt } from './payments.js'
import { overdueInvoiceSql } from './token-charge.js'
import type { ReturnOrigin } from './return-origin.js'
import { enqueueOutbox } from './outbox.js'
import type { PaymentAdapter } from './payment-adapter.js'
import { rearmUnpaidTrialLock } from './trial-lapse.js'
import { loadRelease } from './bundles.js'
import { compilePurchasedEntitlement, holdsTrialAfterLapseSql, owesAtRenewal } from './free-base.js'

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
      AND r.period_start=s.renewal_at AND r.kind='renewal' AND r.status<>'superseded') AS has_renewal,sr.snapshot->'pricing' AS pricing
    FROM subscriptions s JOIN subscription_revisions sr ON sr.id=s.applied_revision_id WHERE s.state IN ('active','past_due') AND NOT s.manual_suspension
    AND s.applied_revision_id IS NOT NULL AND s.renewal_at <= $1::date AND ($2::uuid IS NULL OR s.id=$2)
    AND NOT ${holdsTrialAfterLapseSql('s')} ORDER BY s.id`, [today, subscription_id ?? null])).rows
  // A subscription that is no longer a candidate (suspended, cancelled, changed, or already renewed) has nothing left to fail.
  await pool.query(`UPDATE subscriptions SET renewal_failure=NULL,renewal_failed_at=NULL WHERE renewal_failure IS NOT NULL
    AND ($2::uuid IS NULL OR id=$2) AND (NOT (id = ANY($1::uuid[])) OR id = ANY($3::uuid[]))`,
  [candidates.map(c => c.id), subscription_id ?? null, candidates.filter(c => c.has_renewal).map(c => c.id)])
  let unusableOrigins = 0
  const generated: ReturnType<typeof orderView>[] = []
  const failures: unknown[] = []
  for (const candidate of candidates) {
    // One subscription that cannot renew is recorded (log + vendor attention) and never stops the ones after it.
    try {
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
      if (sub.manual_suspension || sub.target_revision_id || !['active','past_due'].includes(sub.state) || !sub.applied_revision_id || !sub.renewal_at || date(sub.renewal_at)>today) return null
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
      const pricing = await pricingOf(client, snapshot)
      const converting = sub.trial_ends_at !== null && sub.trial_outcome === 'converted'
      const extraBranches = Number(snapshot.included_extra_branches) + pricing.paid_extra_branches
      const quantities = { users: sources.plan.included_users + pricing.paid_users, storage_mb: sources.plan.included_storage_mb + pricing.paid_storage_gb * 1024 }
      const entitlement = converting ? compilePurchasedEntitlement({ ...sources,
        release: await loadRelease(client, snapshot.entitlement.catalog_release_id), quantities, extraBranches }) : snapshot.entitlement
      const quote = computeQuote({ ...sources,kind:'new',cadence:snapshot.cadence,
        requested_extra_branches: extraBranches, requested_users: quantities.users, requested_storage_mb: quantities.storage_mb,
        paid_through: sub.trial_paid_through ?? undefined,
        effective_date:start,period:{start,end},ids:{ id:randomUUID(),customer_id:sub.customer_id,subscription_id:sub.id,expected_subscription_revision:sub.revision },
        expires_at:new Date(now.getTime()+30*60_000).toISOString(),entitlement_digest:entitlement.digest })
      await client.query('INSERT INTO commercial_quotes(id,customer_id,payload,digest,expires_at) VALUES($1,$2,$3,$4,$5)', [quote.id,sub.customer_id,JSON.stringify(quote),quote.digest,quote.expires_at])
      // Odoo may already have materialized the restricted policy for the trial revision. A paid
      // conversion advances the revision, so the host applies the whole purchased policy again.
      const targetRevision = converting ? randomUUID() : sub.applied_revision_id
      if (converting) {
        const { branch_archive_ids: _archive, branch_restore_ids: _restore, ...applied } = snapshot
        const converted = { ...applied, period_start: start, period_end: end, entitlement, trial_end: true, quote_id: quote.id }
        await client.query('INSERT INTO subscription_revisions(id,subscription_id,revision,snapshot,quote_id) VALUES($1,$2,$3,$4,$5)',
          [targetRevision, sub.id, sub.revision + 1, JSON.stringify(converted), quote.id])
        await client.query('UPDATE subscriptions SET target_revision_id=$2,revision=revision+1 WHERE id=$1', [sub.id, targetRevision])
      }
      const key = `renewal:${sub.id}:${start}:${renewalId}`
      const row = (await client.query(`INSERT INTO orders(id,customer_id,subscription_id,kind,quote_id,target_revision_id,expected_applied_revision_id,
        payment_state,fulfillment_state,effective_at,idempotency_key,request_digest,due_now_minor,currency,exponent)
        VALUES($1,$2,$3,'renewal',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [randomUUID(),sub.customer_id,sub.id,quote.id,targetRevision,sub.applied_revision_id,quote.due_now.minor ? 'awaiting_payment':'not_required',
        quote.due_now.minor ? 'not_started':'queued',`${start}T00:00:00+03:00`,key,digestOf({subscription_id:sub.id,period_start:start,quote_digest:quote.digest}),quote.due_now.minor,quote.due_now.currency,quote.due_now.exponent])).rows[0]
      const order = orderView(row)
      const immediate = converting
        || (await client.query("SELECT 1 FROM trial_lapses WHERE subscription_id=$1 AND state='done' AND period_start=$2", [sub.id, start])).rowCount
      const invoice = await issueInvoiceFromQuote(client, { order, quote, dueDays: immediate ? 0 : undefined })
      await client.query('UPDATE renewals SET order_id=$2,invoice_id=$3 WHERE id=$1', [renewalId,order.id,invoice?.id ?? null])
      if (!invoice) {
        await onRenewalPaid(client, order.id)
        await enqueueOutbox(client,{kind:'fulfillment.enqueue',aggregate_id:order.id,dedupe_key:order.target_revision_id,
          payload:{order_id:order.id,subscription_id:sub.id,target_revision_id:order.target_revision_id}})
      }
      // The block ends with the order it was blocking, in the same transaction: a run that fails or finds nothing to
      // generate leaves the flag for the vendor.
      await client.query('UPDATE subscriptions SET billing_blocked_at=NULL,renewal_failure=NULL,renewal_failed_at=NULL WHERE id=$1 AND (billing_blocked_at IS NOT NULL OR renewal_failure IS NOT NULL)', [sub.id])
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
    // Stored-method attempts are inert until a later phase installs the notice and consent gate.
    await createPaymentAttempt(pool, { order_id: order.id, customer_id: sub.customer_id, adapter, returnOrigin: async () => origin })
    } catch (error) {
      await recordRenewalFailure(pool, candidate.id, error)
      failures.push(error)
    }
  }
  // A candidate that failed is already logged and flagged for the vendor; it must not hide what the others generated or fail the
  // job past the rest of the tick. A caller that asked for one subscription still gets its error.
  if (failures.length && subscription_id) throw failures[0]
  if (unusableOrigins) throw new CommercialHttpError('return_url_forbidden', 422)
  return generated
}

/** Explicit log and a durable mark the vendor attention list shows (`renewal_failed`) until a renewal is generated for the subscription. */
async function recordRenewalFailure(pool: Pool, subscriptionId: string, error: unknown) {
  const code = String((error as { code?: string })?.code ?? (error instanceof Error ? error.message : 'renewal_failed')).slice(0, 200)
  console.error(JSON.stringify({ event: 'commercial_renewal_failed', subscription_id: subscriptionId, error: code }))
  await pool.query('UPDATE subscriptions SET renewal_failure=$2,renewal_failed_at=COALESCE(renewal_failed_at,now()) WHERE id=$1', [subscriptionId, code])
}

export async function applyDunning(pool: Pool, { now = new Date() }: { now?: Date } = {}) {
  const due = (await pool.query(`SELECT s.id FROM subscriptions s WHERE s.state IN ('active','past_due')
    AND NOT s.manual_suspension AND NOT ${holdsTrialAfterLapseSql('s')}
    AND EXISTS (SELECT 1 FROM invoices i WHERE i.subscription_id=s.id AND ${overdueInvoiceSql('i', '$1')})
    ORDER BY s.id`, [now])).rows
  const results: { subscription_id: string; state: string }[] = []
  for (const { id } of due) {
    try {
      const state = await transaction(pool, async client => {
        const row = (await client.query(`SELECT s.*,sr.snapshot,p.grace_days,p.auto_suspend FROM subscriptions s
          JOIN subscription_revisions sr ON sr.id=s.applied_revision_id
          JOIN plan_revisions p ON p.id=(sr.snapshot->>'plan_revision_id')::uuid
          WHERE s.id=$1 AND s.state IN ('active','past_due') AND NOT s.manual_suspension
          AND NOT ${holdsTrialAfterLapseSql('s')} FOR UPDATE OF s SKIP LOCKED`, [id])).rows[0]
        if (!row || !owesAtRenewal(row.snapshot.pricing)) return
        const due = (await client.query(`SELECT min(i.due_at) AS due_at FROM invoices i WHERE i.subscription_id=$1 AND ${overdueInvoiceSql('i', '$2')}`, [id, now])).rows[0].due_at
        if (!due) return
        const grace = row.grace_ends_at ?? new Date(new Date(due).getTime() + Number(row.grace_days) * 86_400_000)
        const elapsed = new Date(grace).getTime() <= now.getTime()
        if (elapsed && row.snapshot.pricing?.base_minor === 0 && await rearmUnpaidTrialLock(client, id, now)) return row.state as string
        const next = row.auto_suspend && elapsed ? 'suspended' : 'past_due'
        if (row.state !== next || !row.grace_ends_at)
          await client.query('UPDATE subscriptions SET state=$2,grace_ends_at=$3,revision=revision+1 WHERE id=$1', [id, next, grace])
        await client.query("UPDATE renewals SET status=$2 WHERE subscription_id=$1 AND status IN ('invoiced','charging','past_due')", [id, next])
        return next
      })
      if (state) results.push({ subscription_id: id, state })
    } catch (error) { await recordRenewalFailure(pool, id, error) }
  }
  return results
}
