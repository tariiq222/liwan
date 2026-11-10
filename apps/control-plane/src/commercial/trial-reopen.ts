import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { riyadhDate, type Quote } from '@liwan/commercial-contracts'
import { CommercialHttpError, digestOf } from './lifecycle.js'
import { pricingOf } from './quote-sources.js'
import { enqueueOutbox } from './outbox.js'

type Query = Pick<PoolClient, 'query'>
type Subscription = {
  id: string; customer_id: string; tenant_id: string; state: string; revision: number
  applied_revision_id: string | null; target_revision_id: string | null; trial_outcome: string | null
  manual_suspension: boolean
}

const unavailable = () => new CommercialHttpError('trial_not_reopenable', 409)

/** The old lock must still be the applied revision. A paid renewal or a later change owns its own configuration. */
export async function settledTrialReopenSource(client: Query, sub: Subscription) {
  if (!['free_base','kept_subset'].includes(sub.trial_outcome ?? '') || sub.target_revision_id || sub.manual_suspension
    || !['active','past_due','suspended'].includes(sub.state)) return null
  return (await client.query(`SELECT l.trial_revision_id,l.period_start::text AS period_start
    FROM trial_lapses l JOIN orders o ON o.id=l.order_id
    WHERE l.subscription_id=$1 AND l.state='done' AND o.target_revision_id=$2 AND NOT EXISTS (
      SELECT 1 FROM renewals r JOIN orders charged ON charged.id=r.order_id
      WHERE r.subscription_id=$1 AND r.period_start>=l.period_start AND charged.due_now_minor>0
        AND charged.payment_state IN ('paid','refund_pending','refunded'))`, [sub.id, sub.applied_revision_id])).rows[0] ?? null
}

/** The vendor's reopen removes the obligation even for a hosted link still in flight. Any later capture goes to automatic refund. */
async function voidUnpaidTrialInvoices(client: PoolClient, subscriptionId: string, cycleStart: string) {
  const unpaid = (await client.query(`SELECT o.id,i.id AS invoice_id FROM renewals r
    JOIN orders o ON o.id=r.order_id JOIN invoices i ON i.id=r.invoice_id
    WHERE r.subscription_id=$1 AND r.period_start >= $2 AND i.status='issued' AND NOT o.cancelled
      AND o.payment_state IN ('awaiting_payment','failed') AND o.fulfillment_state='not_started'
    ORDER BY o.id FOR UPDATE OF o,i`, [subscriptionId, cycleStart])).rows
  if (!unpaid.length) return []
  const orderIds = unpaid.map(row => row.id)
  await client.query('UPDATE orders SET cancelled=true,automatic_refund=true WHERE id=ANY($1::uuid[])', [orderIds])
  await client.query("UPDATE invoices SET status='void' WHERE id=ANY($1::uuid[])", [unpaid.map(row => row.invoice_id)])
  await client.query("UPDATE renewals SET status='failed' WHERE order_id=ANY($1::uuid[])", [orderIds])
  return orderIds
}

/** Reopening needs a new immutable delivery, since Odoo may already have materialized the restricted digest. */
export async function reopenTrialOn(client: PoolClient, sub: Subscription, input: { endsAt: Date; now: Date; actor: string; reason: string }) {
  if (sub.manual_suspension || sub.target_revision_id || !sub.applied_revision_id || sub.trial_outcome === 'converted') throw unavailable()
  const support = (await client.query('SELECT post_trial_supported,excess_supported FROM tenants WHERE id=$1', [sub.tenant_id])).rows[0]
  if (support?.post_trial_supported !== true || support.excess_supported !== true) throw new CommercialHttpError('tenant_upgrade_required', 409)
  const binding = await client.query('SELECT 1 FROM shared_registry_bindings WHERE control_tenant_id=$1 AND enabled FOR SHARE', [sub.tenant_id])
  if (!binding.rowCount) throw new CommercialHttpError('tenant_binding_unavailable', 409)
  const lapse = sub.state === 'trialing' ? null : await settledTrialReopenSource(client, sub)
  if (sub.state !== 'trialing' && !lapse) throw unavailable()
  const sourceId = lapse?.trial_revision_id ?? sub.applied_revision_id
  const snapshot = (await client.query('SELECT snapshot FROM subscription_revisions WHERE id=$1', [sourceId])).rows[0]?.snapshot
  if (!snapshot) throw unavailable()
  const prior = (await client.query('SELECT payload FROM commercial_quotes WHERE id=$1', [snapshot.quote_id])).rows[0]?.payload as Quote | undefined
  if (!prior) throw unavailable()
  const pricing = await pricingOf(client, snapshot)
  const periodEnd = riyadhDate(input.endsAt)
  const quote: Quote = { ...prior, id: randomUUID(), effective_date: riyadhDate(input.now), expected_subscription_revision: sub.revision,
    due_now: { ...prior.due_now, minor: 0 }, lines: [], next_renewal_at: periodEnd,
    expires_at: new Date(input.now.getTime()+30*60_000).toISOString(), digest: '' }
  quote.digest = digestOf({ ...quote, digest: undefined })
  const revisionId = randomUUID(), orderId = randomUUID()
  const { branch_archive_ids: _archive, branch_restore_ids: _restore, trial_end: _end, ...trial } = snapshot
  const next = { ...trial, period_end: periodEnd, quote_id: quote.id, pricing }
  const voided = lapse ? await voidUnpaidTrialInvoices(client, sub.id, lapse.period_start) : []
  await client.query('INSERT INTO commercial_quotes(id,customer_id,payload,digest,expires_at) VALUES($1,$2,$3,$4,$5)',
    [quote.id, sub.customer_id, JSON.stringify(quote), quote.digest, quote.expires_at])
  await client.query('INSERT INTO subscription_revisions(id,subscription_id,revision,snapshot,quote_id) VALUES($1,$2,$3,$4,$5)',
    [revisionId, sub.id, sub.revision+1, JSON.stringify(next), quote.id])
  await client.query(`UPDATE subscriptions SET state='trialing',trial_ends_at=$2,trial_ended_at=NULL,trial_outcome=NULL,trial_paid_through=NULL,
    grace_ends_at=NULL,billing_blocked_at=NULL,renewal_at=$3,target_revision_id=$4,revision=revision+1 WHERE id=$1`, [sub.id,input.endsAt,periodEnd,revisionId])
  if (lapse) await client.query("UPDATE trial_lapses SET state='superseded',reason=NULL WHERE subscription_id=$1", [sub.id])
  const key = `trial-reopen:${sub.id}:${sub.revision}`
  await client.query(`INSERT INTO orders(id,customer_id,subscription_id,kind,quote_id,target_revision_id,expected_applied_revision_id,
    payment_state,fulfillment_state,effective_at,idempotency_key,request_digest,due_now_minor,currency,exponent)
    VALUES($1,$2,$3,'change',$4,$5,$6,'not_required','queued',$7,$8,$9,0,$10,$11)`,
  [orderId, sub.customer_id, sub.id, quote.id, revisionId, sub.applied_revision_id, input.now, key,
    digestOf({ source_revision_id: sourceId, trial_ends_at: input.endsAt }), quote.due_now.currency, quote.due_now.exponent])
  await enqueueOutbox(client, { kind: 'fulfillment.enqueue', aggregate_id: orderId, dedupe_key: revisionId,
    payload: { order_id: orderId, subscription_id: sub.id, target_revision_id: revisionId } })
  await client.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)',
    [randomUUID(), input.actor, 'trial.reopened', sub.id, input.reason, JSON.stringify({
      source_revision_id: sourceId, target_revision_id: revisionId, trial_ends_at: input.endsAt, voided_order_ids: voided,
    })])
  return { customer_id: sub.customer_id, trial_ends_at: input.endsAt }
}
