import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { z } from 'zod'
import { transaction } from '../db.js'
import { riyadhDate } from '@liwan/commercial-contracts'
import { CommercialHttpError } from './lifecycle.js'
import { closeOtherAttempts, settleAttemptIn } from './payments.js'
import { enqueueOutbox } from './outbox.js'
import type { PaymentAdapter } from './payment-adapter.js'
import { isPaidFirstOrder, requireReachableManager } from './orders.js'
import type { ProviderEvent } from './payment-adapter.js'
import { bankAccountOf, billingSettings } from './billing-settings.js'

/** A transfer the vendor saw arrive: their own reference, the exact amount, and the day the money reached the account. */
export const bankTransferInputSchema = z.strictObject({
  reference: z.string().trim().min(3).max(200),
  amount: z.number().int().nonnegative(),
  value_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().trim().min(3).max(1000).optional(),
})
export type BankTransferInput = z.infer<typeof bankTransferInputSchema>

export type BankTransferResult = { attempt: Record<string, unknown>; invoice_id: string; order_id: string; replay: boolean }

const attemptView = (row: Record<string, any>) => ({
  id: row.id as string, order_id: row.order_id as string, invoice_id: row.invoice_id as string,
  provider: 'bank_transfer' as const, mode: row.mode as string, provider_ref: row.provider_ref as string | null,
  status: row.status as string, amount: { minor: Number(row.amount_minor), currency: row.currency, exponent: Number(row.exponent) },
  value_date: row.value_date as string | null,
})

/** A real calendar date, and never in the future: a transfer cannot have arrived tomorrow. */
function assertValueDate(value: string, today: string) {
  const parsed = new Date(`${value}T12:00:00+03:00`)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value)
    throw new CommercialHttpError('invalid_value_date', 422, 'value_date')
  if (value > today) throw new CommercialHttpError('value_date_in_future', 422, 'value_date')
}

/**
 * A5: the value date is a real Riyadh calendar day and not in the future. Both bounds are checked before the invoice is
 * read, so a malformed date is refused without touching the row.
 *
 * A date before the invoice was issued is deliberately allowed: a customer may transfer the day an invoice is raised in
 * another timezone, and an operator correcting a record may legitimately back-date by a day. The refund window reads
 * `succeeded_at`, which the value date sets, so a wildly old date is bounded by the not-in-the-future rule only — the
 * operator records what the bank statement shows.
 */
function assertValueDateForInvoice(value: string, today: string, invoice?: Record<string, any>) {
  assertValueDate(value, today)
  const issued = invoice?.issued_at ? riyadhDate(new Date(invoice.issued_at)) : null
  if (issued && value < issued) throw new CommercialHttpError('value_date_before_invoice', 422, 'value_date')
}

/**
 * A5: the immutable success time of a transfer, built explicitly in Riyadh time rather than from the session timezone.
 * A bare `date + time` cast is interpreted in whatever TimeZone the connection happens to carry, so the same value
 * date would produce a different instant (and a different refund-window day) depending on the client. Noon Riyadh is
 * used because it is unambiguously inside the intended calendar day in every timezone.
 */
const RIYADH_SUCCEEDED_AT = (param: string) => `((${param}::timestamp + time '12:00') AT TIME ZONE 'Asia/Riyadh')`

/**
 * Records that the vendor received one bank transfer for one issued invoice, and settles it in the SAME transaction
 * (A3): the attempt, the order's payment and fulfillment state, the paid invoice, the fulfillment job that provisions
 * the tenant and issues the manager invitation, and the audit row all commit together or not at all. Settlement is the
 * payment module's own `settleAttemptIn`, so there is one settlement implementation, not two.
 *
 * Replays: the same reference for the same invoice is a retry after a lost response. It settles the attempt if it is
 * not settled yet and answers `replay: true` only once the order really is paid.
 */
export async function confirmBankTransfer(pool: Pool, input: BankTransferInput & { invoice_id: string; operator: string; adapter?: PaymentAdapter }): Promise<BankTransferResult> {
  // Each field has its own code, so the console names what is actually wrong instead of blaming the date.
  let parsed: BankTransferInput
  try { parsed = bankTransferInputSchema.parse({ reference: input.reference, amount: input.amount, value_date: input.value_date, reason: input.reason }) }
  catch (error) {
    const field = (error as { issues?: Array<{ path?: PropertyKey[] }> }).issues?.[0]?.path?.[0] ?? 'body'
    const code = field === 'reference' ? 'invalid_transfer_reference' : field === 'amount' ? 'invalid_transfer_amount'
      : field === 'value_date' ? 'invalid_value_date' : field === 'reason' ? 'invalid_transfer_reason' : 'invalid'
    throw new CommercialHttpError(code, 422, String(field))
  }
  const today = riyadhDate(new Date())

  // A3: one lock decides who settles this invoice — the order row — and the invoice is read inside the transaction,
  // after it, so its status cannot change between the check and the write.
  const settled = await transaction(pool, async client => {
    const head = (await client.query('SELECT order_id FROM invoices WHERE id=$1', [input.invoice_id])).rows[0]
    if (!head) throw new CommercialHttpError('not_found', 404)
    const order = (await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [head.order_id ?? '00000000-0000-4000-8000-000000000000'])).rows[0]
    if (!order) throw new CommercialHttpError('invoice_not_payable', 409)
    const invoice = (await client.query('SELECT * FROM invoices WHERE id=$1 FOR SHARE', [head.order_id ? input.invoice_id : '00000000-0000-4000-8000-000000000000'])).rows[0]
    if (!invoice) throw new CommercialHttpError('not_found', 404)
    assertValueDateForInvoice(parsed.value_date, today, invoice)
    if (Number(invoice.total_minor) !== parsed.amount) throw new CommercialHttpError('transfer_amount_mismatch', 422)
    const existing = (await client.query("SELECT * FROM payment_attempts WHERE provider='bank_transfer' AND provider_ref=$1", [parsed.reference])).rows[0]
    if (existing) {
      // The same reference on another invoice is a recorded mistake; the same one on this invoice is a replay.
      if (existing.invoice_id !== invoice.id) throw new CommercialHttpError('transfer_reference_in_use', 409)
      return replayOf(client, existing, order)
    }
    // A3: money that arrived for an invoice that is already paid. It is not a mistake to refuse: the money is real, so
    // it is recorded as its own succeeded attempt and goes through the existing duplicate-charge path, which queues one
    // credit note for the operator to refund. The first payment, the order state and the paid invoice do not change.
    if (order.payment_state !== 'awaiting_payment' || order.cancelled) {
      if (isPaid(order)) return { ...await recordDuplicateTransfer(client, { invoice, order, parsed, operator: input.operator }), replay: false }
      throw new CommercialHttpError('order_not_payable', 409)
    }
    // A4/A7: the same reachable-manager predicate the order and a payment attempt use, with the subscription fulfilment
    // will apply, so a bank transfer cannot pay an order whose activation could never invite a manager.
    if (isPaidFirstOrder({ kind: order.kind }, Number(order.due_now_minor), order.expected_applied_revision_id)) {
      const customer = (await client.query('SELECT * FROM customers WHERE id=$1', [order.customer_id])).rows[0]
      const subscription = (await client.query('SELECT id,tenant_id FROM subscriptions WHERE id=$1', [order.subscription_id])).rows[0]
      await requireReachableManager(client, customer, subscription)
    }
    if (invoice.status !== 'issued') throw new CommercialHttpError('invoice_not_payable', 409)
    // A2: `payment_attempts_one_live` allows one open attempt per order, and a customer who abandoned a card checkout
    // leaves a `created`/`redirected` row behind. The transfer is reserved `pending`, so those stale attempts are closed
    // first — in this transaction, so a failure below puts them back.
    await client.query("UPDATE payment_attempts SET status='failed', updated_at=now() WHERE order_id=$1 AND status IN ('created','redirected','unknown')", [order.id])
    // The attempt is reserved NOT settled: apply (below) is what flips it to succeeded and pays the order.
    // succeeded_at is the value date: the day the money reached the account, not the day it was recorded. apply()
    // keeps the first value it finds, so this survives the settlement that follows.
    const row = (await client.query(`INSERT INTO payment_attempts(id,order_id,invoice_id,provider,mode,provider_ref,amount_minor,currency,exponent,status,value_date,succeeded_at)
      VALUES($1,$2,$3,'bank_transfer','live',$4,$5,$6,$7,'pending',$8::date,${RIYADH_SUCCEEDED_AT('$8')}) RETURNING *`,
    [randomUUID(), order.id, invoice.id, parsed.reference, Number(invoice.total_minor), invoice.currency, Number(invoice.exponent), parsed.value_date])).rows[0]
    const outcome = await settleAttemptIn(client, transferEvent(row, order))
    if (outcome !== 'accepted') throw new CommercialHttpError('order_not_payable', 409)
    await client.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)',
      [randomUUID(), input.operator, 'payment.bank_transfer_received', order.id, parsed.reason ?? 'Bank transfer received',
        JSON.stringify({ attempt_id: row.id, invoice_id: invoice.id, reference: parsed.reference, amount_minor: Number(invoice.total_minor), value_date: parsed.value_date })])
    const after = (await client.query('SELECT * FROM payment_attempts WHERE id=$1', [row.id])).rows[0]
    return { attempt: after, order_id: order.id as string, replay: false }
  })
  // After the commit: an open Moyasar attempt on the same order must not stay payable and later become an
  // unrefundable duplicate. This needs the provider, so it cannot live inside the transaction.
  if (!settled.replay && input.adapter && settled.attempt.status === 'succeeded') {
    try { await closeOtherAttempts(pool, input.adapter, transferEvent(settled.attempt, { id: settled.order_id })) } catch { /* the reconciler retries a closing it could not make */ }
  }
  return { attempt: attemptView(settled.attempt), invoice_id: input.invoice_id, order_id: settled.order_id, replay: settled.replay }
}

/** A paid order: a second transfer for it is a duplicate, not a new payment. */
const isPaid = (order: Record<string, any>) => ['paid', 'refund_pending', 'refunded'].includes(order.payment_state)

/**
 * A3: a transfer that arrived on an already-paid order. It is stored as its own succeeded attempt with its own
 * provider_ref (the reference index keeps the two apart), audited as `payment.bank_transfer_duplicate`, and queued on
 * the same `reconcile.refund` path a second provider charge takes, so `processRefundOutbox` writes the one system credit
 * note for it. Nothing about the first payment, the order or the invoice moves — which is exactly how the duplicate
 * provider charge behaves, and why the first payment stays the customer's first.
 */
async function recordDuplicateTransfer(client: PoolClient, input: { invoice: Record<string, any>; order: Record<string, any>; parsed: BankTransferInput; operator: string }) {
  const { invoice, order, parsed, operator } = input
  const row = (await client.query(`INSERT INTO payment_attempts(id,order_id,invoice_id,provider,mode,provider_ref,amount_minor,currency,exponent,status,value_date,succeeded_at)
    VALUES($1,$2,$3,'bank_transfer','live',$4,$5,$6,$7,'succeeded',$8::date,${RIYADH_SUCCEEDED_AT('$8')}) RETURNING *`,
  [randomUUID(), order.id, invoice.id, parsed.reference, Number(invoice.total_minor), invoice.currency, Number(invoice.exponent), parsed.value_date])).rows[0]
  const reason = `duplicate bank transfer — manual review (attempt ${row.id})`
  const eventId = `bank-transfer-duplicate:${row.id}`
  // Same dedupe key shape as the provider's duplicate path: one outbox row per duplicate attempt, so a retry of this
  // route (which cannot happen for a new reference, but could after a lost response) never queues a second note.
  const inserted = await enqueueOutbox(client, { kind: 'reconcile.refund', aggregate_id: order.id, dedupe_key: eventId,
    payload: { order_id: order.id, attempt_id: row.id, reference: parsed.reference, duplicate: true } })
  if (inserted) await client.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)',
    [randomUUID(), operator, 'payment.bank_transfer_duplicate', order.id, reason,
      JSON.stringify({ attempt_id: row.id, invoice_id: invoice.id, reference: parsed.reference, amount_minor: Number(invoice.total_minor), value_date: parsed.value_date })])
  return { attempt: row, order_id: order.id as string }
}

/** A retry with the same reference. Settles an attempt whose settlement was lost; a replay once the order is paid. */
async function replayOf(client: PoolClient, existing: Record<string, any>, order: Record<string, any>) {
  // Only the attempt that paid the order is a replay. A duplicate transfer (or any sibling attempt) is already
  // succeeded while the order is paid by another attempt: answering `replay: true` would claim this reference paid it.
  if (existing.status === 'succeeded' && order.paid_attempt_id === existing.id) return { attempt: existing, order_id: order.id as string, replay: true }
  if (existing.status === 'succeeded') return { attempt: existing, order_id: order.id as string, replay: false }
  // The reservation committed but the settlement did not: the money is recorded and the order is still open.
  if (order.payment_state === 'awaiting_payment' && !order.cancelled) {
    const outcome = await settleAttemptIn(client, transferEvent(existing, order))
    if (outcome !== 'accepted') throw new CommercialHttpError('order_not_payable', 409)
    const after = (await client.query('SELECT * FROM payment_attempts WHERE id=$1', [existing.id])).rows[0]
    return { attempt: after, order_id: order.id as string, replay: after.status === 'succeeded' }
  }
  throw new CommercialHttpError('order_not_payable', 409)
}

/** The provider event that settles one bank-transfer attempt; its success time is the value date, not the recording. */
function transferEvent(attempt: Record<string, any>, order: Record<string, any>): ProviderEvent {
  return {
    provider: 'bank_transfer', event_id: `bank-transfer:${attempt.provider_ref}`, provider_ref: attempt.provider_ref as string,
    payment_id: null, attempt_id: attempt.id as string, merchant_account: 'bank', live: true, status: 'succeeded',
    amount: { minor: Number(attempt.amount_minor), currency: attempt.currency as string, exponent: Number(attempt.exponent) },
    occurred_at: `${attempt.value_date}T00:00:00+03:00`, raw_type: 'bank_transfer_received',
  }
}

/** What a customer sees to make a transfer: the amount, the invoice reference and the vendor's own account. */
export async function bankTransferInstructions(pool: Pool, input: { invoice_id: string; customer_id?: string }) {
  const args: unknown[] = [input.invoice_id]
  let where = 'id=$1'
  if (input.customer_id) { args.push(input.customer_id); where += ' AND customer_id=$2' }
  const invoice = (await pool.query(`SELECT * FROM invoices WHERE ${where}`, args)).rows[0]
  if (!invoice) throw new CommercialHttpError('not_found', 404)
  const account = bankAccountOf(await billingSettings(pool))
  if (!account) throw new CommercialHttpError('bank_account_unavailable', 409)
  return { invoice_id: invoice.id as string, status: invoice.status as string, reference: (invoice.number ?? invoice.id) as string,
    amount_minor: Number(invoice.total_minor), currency: invoice.currency as string, exponent: Number(invoice.exponent),
    bank: account }
}
