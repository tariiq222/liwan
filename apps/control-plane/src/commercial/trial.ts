import { createHash, randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { acceptQuoteRequestSchema, canonicalJson, quoteRequestSchema, quoteSchema, riyadhDate, type Principal, type Quote } from '@webvue/commercial-contracts'
import { transaction } from '../db.js'
import { CommercialHttpError, digestOf } from './lifecycle.js'
import { acceptQuoteOn } from './orders.js'
import { buildQuote } from './quotes.js'
import { trialEndsAt } from './renewals.js'

/** A trial is an ordinary zero-due order: same snapshot, fulfillment and entitlement as a paid purchase. */
export async function startTrial(pool: Pool, input: { customer_id: string; request: unknown; principal: Principal; now?: Date }) {
  const now = input.now ?? new Date()
  const request = quoteRequestSchema.omit({ subscription_id: true }).parse(input.request)
  const plan = (await pool.query('SELECT trial_days FROM plan_revisions WHERE id=$1', [request.plan_revision_id])).rows[0]
  if (!plan) throw new CommercialHttpError('plan_missing', 404)
  if (!plan.trial_days) throw new CommercialHttpError('trial_disabled', 422)
  const today = riyadhDate(now)
  const built = await buildQuote(pool, { customer_id: input.customer_id, request: { ...request, effective_date: today } }, now)
  const endsAt = trialEndsAt(plan.trial_days, now)
  const trialQuote = redigest({ ...built, due_now: { ...built.due_now, minor: 0 }, next_renewal_at: riyadhDate(new Date(endsAt)) })
  const acceptInput = acceptQuoteRequestSchema.parse({ quote_id: trialQuote.id, expected_subscription_revision: 0, idempotency_key: randomUUID() })
  const digest = digestOf(acceptInput)
  const result = await transaction(pool, async client => {
    const customer = (await client.query('SELECT * FROM customers WHERE id=$1 FOR UPDATE', [input.customer_id])).rows[0]
    if (!customer) throw new CommercialHttpError('not_found', 404)
    if (customer.trial_used_at) throw new CommercialHttpError('trial_already_used', 409)
    const existing = (await client.query('SELECT * FROM subscriptions WHERE customer_id=$1 FOR UPDATE', [input.customer_id])).rows[0]
    if (existing?.applied_revision_id) throw new CommercialHttpError('trial_not_available', 409)
    await client.query('INSERT INTO commercial_quotes(id,customer_id,payload,digest,expires_at) VALUES($1,$2,$3,$4,$5)', [trialQuote.id, input.customer_id, JSON.stringify(quoteSchema.parse(trialQuote)), trialQuote.digest, trialQuote.expires_at])
    await client.query('UPDATE customers SET trial_used_at=now() WHERE id=$1', [input.customer_id])
    const accepted = await acceptQuoteOn(client, acceptInput, digest, trialQuote, input.principal)
    await client.query("UPDATE subscriptions SET state='trialing',trial_ends_at=$2,revision=revision+1 WHERE customer_id=$1", [input.customer_id, endsAt])
    return accepted
  })
  const subscription = await pool.query('SELECT * FROM subscriptions WHERE customer_id=$1', [input.customer_id])
  return { order: result.order, subscription: subscription.rows[0], replay: result.replay }
}

/** Recompute the digest after changing only the trial amount and the first renewal date. */
function redigest(quote: Quote): Quote {
  const { id: _id, digest: _digest, ...body } = quote
  return { ...quote, digest: createHash('sha256').update(canonicalJson({ kind: 'new', ...body })).digest('hex') }
}
