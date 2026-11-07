import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { z } from 'zod'
import { transaction } from '../db.js'
import { riyadhDate } from '@liwan/commercial-contracts'
import { CommercialHttpError } from './lifecycle.js'
import { closeOtherAttempts, settleAttemptIn } from './payments.js'
import type { PaymentAdapter } from './payment-adapter.js'
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
  if (value > today) throw new CommercialHttpError('invalid_value_date', 422, 'value_date')
}

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
  // One refusal code for every unusable transfer body, so the console can name what is wrong instead of "generic".
  let parsed: BankTransferInput
  try { parsed = bankTransferInputSchema.parse({ reference: input.reference, amount: input.amount, value_date: input.value_date, reason: input.reason }) }
  catch { throw new CommercialHttpError('invalid_value_date', 422, 'value_date') }
  assertValueDate(parsed.value_date, riyadhDate(new Date()))
  const invoice = (await pool.query('SELECT * FROM invoices WHERE id=$1', [input.invoice_id])).rows[0]
  if (!invoice) throw new CommercialHttpError('not_found', 404)
  if (Number(invoice.total_minor) !== parsed.amount) throw new CommercialHttpError('transfer_amount_mismatch', 422)

  const settled = await transaction(pool, async client => {
    // One lock decides who settles this invoice: the order row. Two operators recording together queue here.
    const order = (await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [invoice.order_id ?? '00000000-0000-4000-8000-000000000000'])).rows[0]
    if (!order) throw new CommercialHttpError('invoice_not_payable', 409)
    const existing = (await client.query("SELECT * FROM payment_attempts WHERE provider='bank_transfer' AND provider_ref=$1", [parsed.reference])).rows[0]
    if (existing) {
      // The same reference on another invoice is a recorded mistake; the same one on this invoice is a replay.
      if (existing.invoice_id !== invoice.id) throw new CommercialHttpError('transfer_reference_in_use', 409)
      const replay = await settleExisting(client, existing, order)
      return { attempt: replay.attempt, order_id: order.id as string, replay: replay.replay }
    }
    if (order.payment_state !== 'awaiting_payment' || order.cancelled) throw new CommercialHttpError('order_not_payable', 409)
    if (invoice.status !== 'issued') throw new CommercialHttpError('invoice_not_payable', 409)
    // The attempt is reserved NOT settled: apply (below) is what flips it to succeeded and pays the order.
    // succeeded_at is the value date: the day the money reached the account, not the day it was recorded. apply()
    // keeps the first value it finds, so this survives the settlement that follows.
    const row = (await client.query(`INSERT INTO payment_attempts(id,order_id,invoice_id,provider,mode,provider_ref,amount_minor,currency,exponent,status,value_date,succeeded_at)
      VALUES($1,$2,$3,'bank_transfer','live',$4,$5,$6,$7,'pending',$8,$9::date + time '12:00' + interval '3 hours') RETURNING *`,
    [randomUUID(), order.id, invoice.id, parsed.reference, Number(invoice.total_minor), invoice.currency, Number(invoice.exponent), parsed.value_date, parsed.value_date])).rows[0]
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
  if (!settled.replay && input.adapter) {
    try { await closeOtherAttempts(pool, input.adapter, transferEvent(settled.attempt, { id: settled.order_id })) } catch { /* the reconciler retries a closing it could not make */ }
  }
  return { attempt: attemptView(settled.attempt), invoice_id: invoice.id, order_id: settled.order_id, replay: settled.replay }
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

/** A retry settles an attempt that exists but was never applied; it is a replay only once the order is really paid. */
async function settleExisting(client: PoolClient, attempt: Record<string, any>, order: Record<string, any>) {
  if (attempt.status === 'succeeded' && order.paid_attempt_id === attempt.id)
    return { attempt, replay: true }
  // The reservation committed but the settlement did not: the money is recorded and the order is still open.
  if (attempt.status === 'succeeded' && order.payment_state === 'awaiting_payment') {
    await client.query("UPDATE payment_attempts SET status='pending' WHERE id=$1", [attempt.id])
    const refreshed = (await client.query('SELECT * FROM payment_attempts WHERE id=$1', [attempt.id])).rows[0]
    const outcome = await settleAttemptIn(client, transferEvent(refreshed, order))
    if (outcome !== 'accepted') throw new CommercialHttpError('order_not_payable', 409)
    const after = (await client.query('SELECT * FROM payment_attempts WHERE id=$1', [attempt.id])).rows[0]
    return { attempt: after, replay: after.status === 'succeeded' }
  }
  if (order.payment_state !== 'awaiting_payment' || order.cancelled) throw new CommercialHttpError('order_not_payable', 409)
  const outcome = await settleAttemptIn(client, transferEvent(attempt, order))
  if (outcome !== 'accepted') throw new CommercialHttpError('order_not_payable', 409)
  const after = (await client.query('SELECT * FROM payment_attempts WHERE id=$1', [attempt.id])).rows[0]
  return { attempt: after, replay: after.status === 'succeeded' }
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
