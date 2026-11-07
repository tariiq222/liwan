import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { z } from 'zod'
import { transaction } from '../db.js'
import { CommercialHttpError } from './lifecycle.js'
import { applyConfirmedEvent } from './payments.js'
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

/**
 * Records that the vendor received one bank transfer for one issued invoice, then settles it through the same
 * `applyConfirmedEvent` boundary a verified Moyasar payment uses: the order is paid, its invoice is paid, the
 * fulfillment job that provisions the tenant and issues the manager invitation is enqueued exactly once.
 *
 * Idempotent on the operator's reference: the same reference for the same invoice returns the recorded attempt and
 * changes nothing. A different amount, a paid or void invoice, or a reference already used elsewhere is refused.
 */
export async function confirmBankTransfer(pool: Pool, input: BankTransferInput & { invoice_id: string; operator: string }): Promise<BankTransferResult> {
  const parsed = bankTransferInputSchema.parse({ reference: input.reference, amount: input.amount, value_date: input.value_date, reason: input.reason })
  const invoice = (await pool.query('SELECT * FROM invoices WHERE id=$1', [input.invoice_id])).rows[0]
  if (!invoice) throw new CommercialHttpError('not_found', 404)
  const reused = (await pool.query("SELECT * FROM payment_attempts WHERE provider='bank_transfer' AND provider_ref=$1", [parsed.reference])).rows[0]
  if (reused) {
    // The same reference for the same invoice is a retry after a lost response; anything else is a mistake.
    if (reused.invoice_id !== invoice.id) throw new CommercialHttpError('transfer_reference_in_use', 409)
    if (Number(reused.amount_minor) !== parsed.amount) throw new CommercialHttpError('transfer_amount_mismatch', 422)
    return { attempt: attemptView(reused), invoice_id: invoice.id, order_id: reused.order_id, replay: true }
  }
  if (Number(invoice.total_minor) !== parsed.amount) throw new CommercialHttpError('transfer_amount_mismatch', 422)
  if (invoice.status !== 'issued') throw new CommercialHttpError('invoice_not_payable', 409)
  if (!invoice.order_id) throw new CommercialHttpError('invoice_not_payable', 409)

  const reserved = await transaction(pool, async client => {
    const order = (await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [invoice.order_id])).rows[0]
    if (!order) throw new CommercialHttpError('not_found', 404)
    // The amount and the invoice state are re-read under the order lock: two operators recording at once agree.
    if (order.payment_state !== 'awaiting_payment' || order.cancelled) throw new CommercialHttpError('order_not_payable', 409)
    const again = (await client.query("SELECT * FROM payment_attempts WHERE provider='bank_transfer' AND provider_ref=$1", [parsed.reference])).rows[0]
    if (again) return { existing: again }
    const row = (await client.query(`INSERT INTO payment_attempts(id,order_id,invoice_id,provider,mode,provider_ref,amount_minor,currency,exponent,status,value_date)
      VALUES($1,$2,$3,'bank_transfer','live',$4,$5,$6,$7,'succeeded',$8) RETURNING *`,
    [randomUUID(), order.id, invoice.id, parsed.reference, Number(invoice.total_minor), invoice.currency, Number(invoice.exponent), parsed.value_date])).rows[0]
    return { fresh: row }
  })
  if ('existing' in reserved) return { attempt: attemptView(reserved.existing), invoice_id: invoice.id, order_id: reserved.existing.order_id, replay: true }

  const attempt = reserved.fresh
  const event: ProviderEvent = {
    provider: 'bank_transfer', event_id: `bank-transfer:${parsed.reference}`, provider_ref: parsed.reference,
    payment_id: null, attempt_id: attempt.id, merchant_account: 'bank',
    live: true, status: 'succeeded',
    amount: { minor: Number(invoice.total_minor), currency: invoice.currency, exponent: Number(invoice.exponent) },
    occurred_at: `${parsed.value_date}T00:00:00+03:00`, raw_type: 'bank_transfer_received',
  }
  const outcome = await applyConfirmedEvent(pool, event)
  if (outcome !== 'accepted') throw new CommercialHttpError('order_not_payable', 409)
  await transaction(pool, async client => {
    await client.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)',
      [randomUUID(), input.operator, 'payment.bank_transfer_received', attempt.order_id, parsed.reason ?? 'Bank transfer received',
        JSON.stringify({ attempt_id: attempt.id, invoice_id: invoice.id, reference: parsed.reference, amount_minor: Number(invoice.total_minor), value_date: parsed.value_date })])
  })
  return { attempt: attemptView(attempt), invoice_id: invoice.id, order_id: attempt.order_id as string, replay: false }
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
