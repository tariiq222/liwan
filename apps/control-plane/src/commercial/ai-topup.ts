import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { z } from 'zod'
import { AI_TOPUP_CURRENCY, AI_TOPUP_EXPONENT, AI_UNITS_MAX, sarMinorToAiUnits, type Money } from '@liwan/commercial-contracts'
import { transaction } from '../db.js'
import { audit, CommercialHttpError, type CommercialActor } from './lifecycle.js'
import { billingSettings } from './billing-settings.js'
import { refundWindow } from './settlements.js'
import { actorLabel } from '../admin-auth/grants.js'
import { aiBillingSettings, grantedUnits, markTopupRefunded } from './ai-ledger.js'

type Q = Pick<Pool, 'query'>

/**
 * The quote side of a top-up request: the amount must be one the vendor offers, in the plan's currency, and the
 * resulting total must still fit what the entitlement can carry. Returns the one-time line's amount with the units and
 * rate the quote will show, which payment later grants exactly.
 */
export async function resolveTopupAmount(client: Q, customerId: string, minor: number, plan: { currency: string }): Promise<{ amount: Money; units: number; usd_rate: string }> {
  const settings = await aiBillingSettings(client)
  if (!settings.topup_amounts_minor.includes(minor)) throw new CommercialHttpError('ai_topup_amount_not_offered', 422, 'ai_topup_minor')
  // A top-up is priced in riyals; a plan in another currency cannot carry the line.
  if (plan.currency !== AI_TOPUP_CURRENCY) throw new CommercialHttpError('currency_mismatch', 422, 'ai_topup_minor')
  const units = sarMinorToAiUnits(minor, settings.usd_rate)
  if (await grantedUnits(client, customerId) + units > AI_UNITS_MAX) throw new CommercialHttpError('ai_balance_limit_exceeded', 422, 'ai_topup_minor')
  return { amount: { currency: AI_TOPUP_CURRENCY, exponent: AI_TOPUP_EXPONENT, minor }, units, usd_rate: settings.usd_rate }
}

export const topupRefundBodySchema = z.strictObject({
  reason: z.string().trim().min(3).max(1000),
  /** AI cost units of this top-up already spent, as read by the operator in the tenant. Usage is not readable from here (R5), so the operator supplies it. */
  units_used: z.number().int().min(0),
})

/**
 * Vendor refund of a top-up order: inside the refund window and only if none of it was used. Marks the ledger row
 * refunded, pushes the lowered total to the tenant, and opens the pending credit note for the invoice, which the
 * existing flow then records once the operator has refunded at the provider. Only an order that charged nothing else
 * can be refunded here, because a credit note is for the whole invoice. The same existing-note rule as the generic
 * refund applies: any live credit note on the invoice (a provider's included) means a refund is already under way.
 */
export async function refundTopup(pool: Pool, { order_id, actor, reason, units_used }: { order_id: string; actor: CommercialActor; reason: string; units_used: number }) {
  return transaction(pool, async client => {
    const invoice = (await client.query('SELECT * FROM invoices WHERE order_id=$1 FOR UPDATE', [order_id])).rows[0]
    const topup = (await client.query('SELECT * FROM ai_topups WHERE order_id=$1 FOR UPDATE', [order_id])).rows[0]
    if (!topup || !invoice) throw new CommercialHttpError('not_found', 404)
    if (topup.refunded_at) throw new CommercialHttpError('refund_already_requested', 409)
    const noted = await client.query("SELECT 1 FROM invoice_adjustments WHERE invoice_id=$1 AND kind='credit_note' AND status<>'void'", [invoice.id])
    if (noted.rowCount) throw new CommercialHttpError('refund_already_requested', 409)
    if (invoice.status !== 'paid') throw new CommercialHttpError('invoice_not_paid', 409)
    if (units_used > 0) throw new CommercialHttpError('ai_topup_used', 409, 'units_used')
    const others = await client.query("SELECT 1 FROM invoice_lines WHERE invoice_id=$1 AND kind NOT IN ('ai_topup','tax') AND amount_minor>0 LIMIT 1", [invoice.id])
    if (others.rowCount) throw new CommercialHttpError('ai_topup_refund_mixed_order', 409)
    const paid = (await client.query('SELECT a.succeeded_at FROM payment_attempts a JOIN orders o ON o.id=a.order_id WHERE o.id=$1 AND o.paid_attempt_id=a.id', [order_id])).rows[0]
    const { refund_window_days: days } = await billingSettings(client)
    if (!paid?.succeeded_at || !refundWindow(new Date(paid.succeeded_at), days).open) throw new CommercialHttpError('refund_window_closed', 409)
    const noteId = randomUUID()
    await client.query(`INSERT INTO invoice_adjustments(id,invoice_id,customer_id,kind,reason,amount_minor,currency,exponent,status,created_by,origin)
      VALUES($1,$2,$3,'credit_note',$4,$5,$6,$7,'pending',$8,'vendor')`, [noteId, invoice.id, invoice.customer_id, reason, invoice.total_minor, invoice.currency, invoice.exponent, actorLabel(actor)])
    await markTopupRefunded(client, order_id, actorLabel(actor), reason)
    await audit(client, actor, 'ai_topup.refunded', order_id, reason, { adjustment_id: noteId, units: Number(topup.units), amount_minor: Number(topup.amount_minor) })
    return { order_id, units: Number(topup.units), amount_minor: Number(topup.amount_minor), adjustment_id: noteId, granted_units: await grantedUnits(client, topup.customer_id) }
  })
}
