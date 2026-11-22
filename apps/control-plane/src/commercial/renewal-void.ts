import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import type { VoidRenewalOutcome } from '@liwan/commercial-contracts'
import { transaction } from '../db.js'
import { CommercialHttpError } from './lifecycle.js'
import { voidUnpaidRenewals } from './free-base-lock.js'
import { getVendorInvoice, type VendorInvoiceView } from './invoices.js'
import { loadVoidSubject, voidRefusal, type VoidSubject } from './invoice-void-rules.js'

export type VoidRenewalInput = { invoice_id: string; actor: string; reason: string; outcome: Extract<VoidRenewalOutcome, 'rebill'>; now?: Date }

/**
 * Brings a subscription that dunning moved to `past_due` or `suspended` back to `active` once the voided invoice was the last overdue one.
 * A suspension the vendor ordered stays. The state change is a plain revisioned update: the triggers clear the time it left service and
 * queue the workspace resume, which the status sync delivers exactly as it does for `resumeSubscription`. Returns the state afterwards.
 */
async function endDunning(client: PoolClient, subscription: VoidSubject['subscription'], now: Date): Promise<string> {
  if (!['past_due', 'suspended'].includes(subscription.state) || subscription.manual_suspension) return subscription.state
  const stillOverdue = await client.query("SELECT 1 FROM invoices WHERE subscription_id=$1 AND status='issued' AND due_at < $2 LIMIT 1", [subscription.id, now])
  if (stillOverdue.rowCount) return subscription.state
  await client.query("UPDATE subscriptions SET state='active',grace_ends_at=NULL,revision=revision+1 WHERE id=$1", [subscription.id])
  return 'active'
}

/**
 * Voids one unpaid renewal invoice for the vendor. In one transaction, with the subscription locked before the order, the invoice and the
 * renewal: the invoice becomes `void` (no credit note, nothing was received), the order is cancelled for automatic refund so a late capture
 * goes back, and the renewal is superseded so the period is free. Card charges and dunning stop by themselves (they read only issued
 * invoices of orders that are not cancelled). `rebill` leaves the subscription to the next renewal run, which issues a new invoice for
 * the same period. Asking again on a voided invoice returns its current view and writes nothing.
 */
export async function voidRenewalInvoice(pool: Pool, input: VoidRenewalInput): Promise<VendorInvoiceView> {
  const now = input.now ?? new Date()
  await transaction(pool, async client => {
    const subject = await loadVoidSubject(client, input.invoice_id, true)
    if (!subject) throw new CommercialHttpError('not_found', 404)
    if (subject.invoice.kind === 'renewal' && subject.invoice.status === 'void') return
    const refusal = await voidRefusal(client, subject)
    if (refusal) throw new CommercialHttpError(refusal, 409)
    const { subscription, order, renewal } = subject
    const voided = await voidUnpaidRenewals(client, subscription.id, renewal!.start as string)
    // Exactly this invoice's order: anything else would void a renewal nobody asked about.
    if (voided.length !== 1 || voided[0] !== order!.id) throw new CommercialHttpError('invoice_not_voidable', 409)
    const state = await endDunning(client, subscription, now)
    await client.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)', [randomUUID(), input.actor, 'invoice.voided', input.invoice_id, input.reason,
      JSON.stringify({ outcome: input.outcome, subscription_id: subscription.id, order_id: order!.id, renewal_id: renewal!.id, previous_state: subscription.state, state })])
  })
  return (await getVendorInvoice(pool, input.invoice_id))!
}
