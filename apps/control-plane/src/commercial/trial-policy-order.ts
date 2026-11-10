import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { riyadhDate, type Quote } from '@liwan/commercial-contracts'
import { digestOf } from './lifecycle.js'
import { pricingOf } from './quote-sources.js'
import { enqueueOutbox } from './outbox.js'

/** Build an immutable zero-due delivery from an existing trial configuration. Caller owns the subscription row. */
export async function queueTrialPolicyRevision(client: PoolClient, sub: {
  id: string; customer_id: string; revision: number; applied_revision_id: string | null
}, input: { kind: 'trial-bootstrap' | 'trial-reopen'; sourceId: string; endsAt: Date; now: Date }) {
  const { sourceId } = input
  const snapshot = (await client.query('SELECT snapshot FROM subscription_revisions WHERE id=$1 AND subscription_id=$2', [sourceId, sub.id])).rows[0]?.snapshot
  if (!snapshot) return null
  const prior = (await client.query('SELECT payload FROM commercial_quotes WHERE id=$1 AND customer_id=$2', [snapshot.quote_id, sub.customer_id])).rows[0]?.payload as Quote | undefined
  if (!prior) return null
  const pricing = await pricingOf(client, snapshot)
  const periodEnd = riyadhDate(input.endsAt)
  const quote: Quote = { ...prior, id: randomUUID(), effective_date: riyadhDate(input.now), expected_subscription_revision: sub.revision,
    due_now: { ...prior.due_now, minor: 0 }, lines: [], next_renewal_at: periodEnd,
    expires_at: new Date(input.now.getTime()+30*60_000).toISOString(), digest: '' }
  quote.digest = digestOf({ ...quote, digest: undefined })
  const revisionId = randomUUID(), orderId = randomUUID()
  const { branch_archive_ids: _archive, branch_restore_ids: _restore, trial_end: _end, ...trial } = snapshot
  const next = { ...trial, period_end: periodEnd, quote_id: quote.id, pricing }
  await client.query('INSERT INTO commercial_quotes(id,customer_id,payload,digest,expires_at) VALUES($1,$2,$3,$4,$5)',
    [quote.id, sub.customer_id, JSON.stringify(quote), quote.digest, quote.expires_at])
  await client.query('INSERT INTO subscription_revisions(id,subscription_id,revision,snapshot,quote_id) VALUES($1,$2,$3,$4,$5)',
    [revisionId, sub.id, sub.revision+1, JSON.stringify(next), quote.id])
  const key = `${input.kind}:${sub.id}:${sub.revision}`
  await client.query(`INSERT INTO orders(id,customer_id,subscription_id,kind,quote_id,target_revision_id,expected_applied_revision_id,
    payment_state,fulfillment_state,effective_at,idempotency_key,request_digest,due_now_minor,currency,exponent)
    VALUES($1,$2,$3,'change',$4,$5,$6,'not_required','queued',$7,$8,$9,0,$10,$11)`,
  [orderId, sub.customer_id, sub.id, quote.id, revisionId, sub.applied_revision_id, input.now, key,
    digestOf({ source_revision_id: sourceId, trial_ends_at: input.endsAt.toISOString() }), quote.due_now.currency, quote.due_now.exponent])
  await enqueueOutbox(client, { kind: 'fulfillment.enqueue', aggregate_id: orderId, dedupe_key: revisionId,
    payload: { order_id: orderId, subscription_id: sub.id, target_revision_id: revisionId } })
  return { revisionId, periodEnd }
}
