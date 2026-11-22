import type { PoolClient } from 'pg'
import type { VoidBlock } from '@liwan/commercial-contracts'
import { paidRenewalInFlight } from './cancellation-rules.js'
import { unresolvedFreeBaseLock } from './free-base.js'
import { LIVE_ATTEMPT_STATUSES } from './form-payments.js'
import { tenantRetiringSql } from './tenant-deletion-read.js'
import { isTrialCheckout } from './trial-checkout.js'

type Q = Pick<PoolClient, 'query'>
type Row = Record<string, any>
type SubscriptionRow = Row & { id: string }
type OrderRow = Row & { id: string; idempotency_key: string }

/** The rows one void reads: the subscription, the order, the invoice and the renewal that ties them. */
export type VoidSubject = { subscription: SubscriptionRow; order: OrderRow | undefined; invoice: Row; renewal: Row | undefined }

/**
 * Loads the rows of a void. With `lock` they are taken subscription, then order, then invoice, then renewal. Other writers do not all
 * use that order (`payments.ts` locks the order then the invoice; `fulfillment.ts` locks the order and the subscription in one
 * statement), so a void that races one can be chosen as the deadlock victim: the caller answers that as a retryable error. Null for an unknown invoice.
 */
export async function loadVoidSubject(client: Q, invoiceId: string, lock: boolean): Promise<VoidSubject | null> {
  const head = (await client.query('SELECT subscription_id,order_id FROM invoices WHERE id=$1', [invoiceId])).rows[0]
  if (!head) return null
  const suffix = lock ? ' FOR UPDATE' : ''
  const subscription = (await client.query(`SELECT *,renewal_at::text AS renewal_on FROM subscriptions WHERE id=$1${suffix}`, [head.subscription_id])).rows[0]
  const order = head.order_id ? (await client.query(`SELECT * FROM orders WHERE id=$1${suffix}`, [head.order_id])).rows[0] : undefined
  const invoice = (await client.query(`SELECT * FROM invoices WHERE id=$1${suffix}`, [invoiceId])).rows[0]
  const renewal = (await client.query(`SELECT *,period_start::text AS start FROM renewals WHERE invoice_id=$1${suffix}`, [invoiceId])).rows[0]
  return { subscription, order, invoice, renewal }
}

/**
 * Why this invoice cannot be voided now: `invoice_not_voidable` when it is not an unpaid renewal invoice of an ordinary renewal
 * (the action does not apply at all), otherwise the block the vendor can resolve. Null when it can be voided. Pure reads: the
 * caller decides whether the rows are locked. A payment attempt is always the full total, so any live or succeeded attempt
 * means money may exist and the vendor reconciles it first.
 */
export async function voidRefusal(client: Q, subject: VoidSubject): Promise<VoidBlock | 'invoice_not_voidable' | null> {
  const { subscription, order, invoice, renewal } = subject
  if (!order || !renewal || invoice.kind !== 'renewal' || invoice.status !== 'issued' || renewal.status === 'superseded' || isTrialCheckout(order)) return 'invoice_not_voidable'
  if ((await client.query(`SELECT ${tenantRetiringSql('$1')} AS retiring`, [subscription.customer_id])).rows[0].retiring === true) return 'tenant_retiring'
  if (await paidRenewalInFlight(client, subscription.id)) return 'renewal_in_progress'
  if (order.cancelled || order.payment_state !== 'awaiting_payment' || order.fulfillment_state !== 'not_started') return 'invoice_not_voidable'
  if ((await client.query('SELECT 1 FROM payment_attempts WHERE order_id=$1 AND status = ANY($2::text[]) LIMIT 1', [order.id, [...LIVE_ATTEMPT_STATUSES, 'succeeded']])).rowCount) return 'payment_reconciliation_required'
  if ((await client.query('SELECT 1 FROM bank_transfer_claims WHERE invoice_id=$1', [invoice.id])).rowCount) return 'transfer_claimed'
  if (await unresolvedFreeBaseLock(client, subscription)) return 'lock_pending'
  return null
}

/** What the vendor invoice view says: whether the void action can run, and the block to show when it applies but cannot. Not applicable means neither. */
export async function voidStateOf(client: Q, invoiceId: string): Promise<{ voidable: boolean; void_block: VoidBlock | null }> {
  const subject = await loadVoidSubject(client, invoiceId, false)
  const refusal = subject ? await voidRefusal(client, subject) : 'invoice_not_voidable'
  return { voidable: refusal === null, void_block: refusal === 'invoice_not_voidable' ? null : refusal }
}
