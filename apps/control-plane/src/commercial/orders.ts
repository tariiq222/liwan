import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { acceptQuoteRequestSchema, orderSchema, initialOrderStates, quoteSchema, addCadence, type Principal } from '@nasq/commercial-contracts'
import { compileEntitlements } from '@nasq/commercial-contracts/server'
import { transaction } from '../db.js'
import { CommercialHttpError, digestOf, iso } from './lifecycle.js'
import { requireCapability } from './authorization.js'
import { loadQuoteSources, pricingBaseline } from './quotes.js'
import { issueInvoiceFromQuote } from './invoices.js'
import { enqueueOutbox } from './outbox.js'
import { reserveBranchesForOrder } from './branches.js'
import type { PaymentAdapter } from './payment-adapter.js'
import { assertDowngradeFitsUsage } from './usage.js'

export async function cancelOrder(pool: Pool, input: { order_id: string; principal: Principal; reason: string; adapter?: PaymentAdapter }) {
  const { principal, reason, adapter } = input
  requireCapability(principal, principal.kind === 'vendor' ? 'vendor.subscriptions.manage' : 'subscription.manage')
  if (reason.trim().length < 3) throw new CommercialHttpError('reason_required', 422)
  return transaction(pool, async client => {
    const found = (await client.query('SELECT customer_id,subscription_id FROM orders WHERE id=$1', [input.order_id])).rows[0]
    if (!found) throw new CommercialHttpError('not_found', 404)
    const customer = (await client.query('SELECT * FROM customers WHERE id=$1 FOR UPDATE', [found.customer_id])).rows[0]
    if ((principal.customer_id && principal.customer_id !== found.customer_id)
      || (principal.kind === 'customer' && (principal.customer_id !== found.customer_id || principal.tenant_id !== customer.tenant_id)))
      throw new CommercialHttpError('not_found', 404)
    await client.query('SELECT id FROM subscriptions WHERE id=$1 FOR UPDATE', [found.subscription_id])
    const order = (await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [input.order_id])).rows[0]
    if (order.cancelled || order.payment_state !== 'awaiting_payment' || order.fulfillment_state !== 'not_started')
      throw new CommercialHttpError('order_not_cancellable', 409)
    const attempts = (await client.query("SELECT * FROM payment_attempts WHERE order_id=$1 AND status IN ('created','redirected','pending','unknown') FOR UPDATE", [order.id])).rows
    // Preflight every attempt before any provider or local cancellation effect.
    // An unknown outcome must be reconciled before it can be settled as canceled.
    if (attempts.length && !adapter?.cancelAttempt) throw new CommercialHttpError('payment_reconciliation_required', 409)
    for (const attempt of attempts) {
      if (adapter!.provider !== attempt.provider || adapter!.mode !== attempt.mode) throw new CommercialHttpError('provider_mismatch', 409)
      if (attempt.status === 'unknown' || !attempt.provider_ref) throw new CommercialHttpError('payment_reconciliation_required', 409)
    }
    for (const attempt of attempts) {
      await adapter!.cancelAttempt!(attempt.provider_ref)
      await client.query("UPDATE payment_attempts SET status='canceled',updated_at=now() WHERE id=$1", [attempt.id])
    }
    const updated = (await client.query('UPDATE orders SET cancelled=true WHERE id=$1 RETURNING *', [order.id])).rows[0]
    await client.query('UPDATE subscriptions SET target_revision_id=NULL,revision=revision+1 WHERE id=$1 AND target_revision_id=$2', [order.subscription_id,order.target_revision_id])
    await client.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)',
      [randomUUID(),principal.actor_id,'order.cancelled',order.id,reason,JSON.stringify({ customer_id: order.customer_id, target_revision_id: order.target_revision_id })])
    return orderView(updated)
  })
}

export function orderView(row: Record<string, any>) {
  return orderSchema.parse({ id: row.id, customer_id: row.customer_id, subscription_id: row.subscription_id, kind: row.kind,
    quote_id: row.quote_id, target_revision_id: row.target_revision_id, expected_applied_revision_id: row.expected_applied_revision_id,
    payment_state: row.payment_state, fulfillment_state: row.fulfillment_state, effective_at: iso(row.effective_at),
    idempotency_key: row.idempotency_key, request_digest: row.request_digest,
    due_now: { minor: Number(row.due_now_minor), currency: row.currency, exponent: row.exponent }, created_at: iso(row.created_at) })
}

export async function acceptQuote(pool: Pool, value: unknown, principal: Principal) {
  requireCapability(principal, principal.kind === 'vendor' ? 'vendor.subscriptions.manage' : 'subscription.manage')
  const input = acceptQuoteRequestSchema.parse(value)
  const digest = digestOf(input)
  const quoteResult = await pool.query('SELECT payload FROM commercial_quotes WHERE id=$1', [input.quote_id])
  if (!quoteResult.rowCount) throw new CommercialHttpError('not_found', 404)
  const quote = quoteSchema.parse(quoteResult.rows[0].payload)
  if (principal.kind === 'customer' && quote.customer_id !== principal.customer_id) throw new CommercialHttpError('not_found', 404)
  if (principal.kind === 'vendor' && principal.customer_id && quote.customer_id !== principal.customer_id) throw new CommercialHttpError('not_found', 404)
  const replay = async (client: Pick<Pool, 'query'>) => {
    const r = await client.query('SELECT * FROM orders WHERE customer_id=$1 AND idempotency_key=$2', [quote.customer_id, input.idempotency_key])
    if (!r.rowCount) return null
    if (r.rows[0].request_digest !== digest) throw new CommercialHttpError('idempotency_conflict', 409)
    return { order: orderView(r.rows[0]), replay: true }
  }
  try {
    return await transaction(pool, async client => {
      // Lock the existing customer first: it serializes first-subscription creation too.
      const customerResult = await client.query('SELECT * FROM customers WHERE id=$1 FOR UPDATE', [quote.customer_id])
      if (!customerResult.rowCount) throw new CommercialHttpError('not_found', 404)
      const customer = customerResult.rows[0]
      if (principal.kind === 'customer' && customer.tenant_id !== principal.tenant_id) throw new CommercialHttpError('not_found', 404)
      const existing = await replay(client)
      if (existing) return existing
      let subscription = (await client.query('SELECT * FROM subscriptions WHERE customer_id=$1 FOR UPDATE', [quote.customer_id])).rows[0]
      if (!subscription) {
        if (quote.subscription_id || input.expected_subscription_revision !== 0) throw new CommercialHttpError('revision_conflict', 409)
        subscription = (await client.query('INSERT INTO subscriptions(id,customer_id,tenant_id) VALUES($1,$2,$3) RETURNING *', [randomUUID(), customer.id, customer.tenant_id])).rows[0]
      }
      if (subscription.revision !== input.expected_subscription_revision || quote.expected_subscription_revision !== subscription.revision || (quote.subscription_id && quote.subscription_id !== subscription.id)) throw new CommercialHttpError('revision_conflict', 409)
      // A hosted attempt may settle later. Keep its accepted target authoritative
      // until the prior order is applied or explicitly cancelled.
      const pending = await client.query("SELECT 1 FROM orders WHERE subscription_id=$1 AND NOT cancelled AND fulfillment_state<>'applied' LIMIT 1", [subscription.id])
      if (subscription.target_revision_id || pending.rowCount) throw new CommercialHttpError('subscription_change_pending', 409)
      if (new Date(quote.expires_at).getTime() <= Date.now()) throw new CommercialHttpError('quote_expired', 422)
      const branchRequest = (await client.query('SELECT * FROM branch_quote_requests WHERE quote_id=$1', [quote.id])).rows[0]
      const kind = branchRequest ? (branchRequest.adds.length ? 'branch_add' : 'branch_archive') : quote.subscription_id && subscription.applied_revision_id ? 'change' : 'new'
      const sources = await loadQuoteSources(client, customer.id, quote, kind === 'new')
      // Null terms in a persisted quote means no terms, not the newest later revision.
      if (!quote.terms_revision_id) sources.terms = null
      const entitlement = compileEntitlements(sources)
      if (entitlement.digest !== quote.entitlement_digest) throw new CommercialHttpError('revision_conflict', 409)
      const revisionId = randomUUID()
      const previous = subscription.applied_revision_id ? (await client.query('SELECT snapshot FROM subscription_revisions WHERE id=$1', [subscription.applied_revision_id])).rows[0]?.snapshot : null
      if (previous) await assertDowngradeFitsUsage(client, {
        tenant_id: customer.tenant_id, subscription_id: subscription.id,
        previous: previous.entitlement?.features ?? {}, target: entitlement.features,
      })
      const periodStart = previous ? previous.period_start : quote.effective_date
      const periodEnd = previous ? previous.period_end : quote.next_renewal_at
      const included = sources.terms?.included_extra_branches ?? sources.plan.included_extra_branches
      const snapshot = {
        customer_id: customer.id, tenant_id: customer.tenant_id ?? customer.id,
        plan_revision_id: quote.plan_revision_id, bundle_revision_ids: quote.bundle_revision_ids, terms_revision_id: quote.terms_revision_id,
        policy_revision_id: quote.policy_revision_id, cadence: quote.cadence,
        term_start: previous?.term_start ?? periodStart,
        term_end: previous?.term_end ?? addCadence(periodStart, { unit: 'month', count: sources.terms?.term_months ?? sources.plan.term_months }, 1),
        period_start: periodStart, period_end: periodEnd, included_extra_branches: included, extra_branch_count: quote.requested_extra_branches,
        entitlement, quote_id: quote.id, pricing: pricingBaseline(quote, included),
        ...(branchRequest ? { branch_archive_ids: branchRequest.archive } : {}),
      }
      await client.query('INSERT INTO subscription_revisions(id,subscription_id,revision,snapshot,quote_id) VALUES($1,$2,$3,$4,$5)', [revisionId, subscription.id, subscription.revision + 1, JSON.stringify(snapshot), quote.id])
      const updated = await client.query('UPDATE subscriptions SET target_revision_id=$1,revision=revision+1 WHERE id=$2 RETURNING *', [revisionId, subscription.id])
      subscription = updated.rows[0]
      const states = initialOrderStates(quote.due_now)
      const inserted = await client.query(`INSERT INTO orders(id,customer_id,subscription_id,kind,quote_id,target_revision_id,expected_applied_revision_id,payment_state,fulfillment_state,effective_at,idempotency_key,request_digest,due_now_minor,currency,exponent)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`, [randomUUID(), customer.id, subscription.id, kind, quote.id, revisionId, subscription.applied_revision_id, states.payment_state, states.fulfillment_state, `${quote.effective_date}T00:00:00+03:00`, input.idempotency_key, digest, quote.due_now.minor, quote.due_now.currency, quote.due_now.exponent])
      const order = orderView(inserted.rows[0])
      await issueInvoiceFromQuote(client, { order, quote })
      if (kind === 'new' && !branchRequest && quote.requested_extra_branches > 0) {
        await reserveBranchesForOrder(client, { order_id: order.id, subscription_id: subscription.id, tenant_id: subscription.tenant_id,
          adds: Array.from({length:quote.requested_extra_branches}, (_, i) => ({name:`Branch ${i+1}`})),
          quoted_paid: Math.max(0,quote.requested_extra_branches-included), operation_id: order.id })
      }
      if (branchRequest?.adds.length) {
        if (!subscription.tenant_id) throw new CommercialHttpError('tenant_required', 409)
        if (branchRequest.archive.length) throw new CommercialHttpError('mixed_branch_change_unsupported', 422)
        await reserveBranchesForOrder(client, { order_id: order.id, subscription_id: subscription.id, tenant_id: subscription.tenant_id,
          adds: branchRequest.adds, quoted_paid: branchRequest.quoted_paid, operation_id: order.id })
      }
      if (states.payment_state === 'not_required') await enqueueOutbox(client, {kind:'fulfillment.enqueue',aggregate_id:order.id,dedupe_key:revisionId,payload:{ order_id: order.id, subscription_id: subscription.id, target_revision_id: revisionId }})
      await client.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)', [randomUUID(), principal.actor_id, 'order.accepted', order.id, 'Customer accepted immutable quote', JSON.stringify({ quote_id: quote.id, customer_id: customer.id, target_revision_id: revisionId })])
      return { order, replay: false }
    })
  } catch (e) {
    if ((e as { code?: string }).code !== '23505') throw e
    const existing = await replay(pool)
    if (existing) return existing
    throw new CommercialHttpError('revision_conflict', 409)
  }
}
