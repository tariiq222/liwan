import { randomUUID } from 'node:crypto'
import { vi } from 'vitest'
import type { Pool } from 'pg'
import { transaction } from '../db.js'
import { SimulatorAdapter } from '../commercial/payment-simulator.js'
import { PaymentError } from '../commercial/payment-adapter.js'
import { processRefundOutbox, requestInvoiceRefund } from '../commercial/settlements.js'

/** The operator who asks for the refunds of these fixtures. */
export const operator = { issuer: 'vendor-test', actorUid: 7 }

/**
 * Fixtures of the stuck automatic refund suites: a delivered first payment held inside the simulator, a refund the vendor
 * asked for, and the two stuck states of its `reconcile.refund` row (`attempted`, `returned`).
 */
export function stuckRefundFixtures(pool: Pool) {
  /** A delivered first payment whose attempt is a real payment inside the simulator, so the worker can look it up and refund it. */
  async function simulatorPaid(options: { total?: number; customer?: string } = {}) {
    const total = options.total ?? 11500
    const customer = options.customer ?? randomUUID(), sub = randomUUID(), revision = randomUUID(), order = randomUUID(), invoice = randomUUID(), attempt = randomUUID()
    const adapter = new SimulatorAdapter()
    const created = await adapter.createAttempt({ attempt_id: attempt, order_id: order, amount: { minor: total, currency: 'SAR', exponent: 2 },
      description: 'x', success_url: '', back_url: '', callback_url: '' })
    adapter.settle(created.provider_ref)
    await transaction(pool, async c => {
      if (!options.customer) await c.query('INSERT INTO customers(id,name) VALUES($1,$2)', [customer, 'Stuck refund test'])
      await c.query('INSERT INTO subscriptions(id,customer_id) VALUES($1,$2)', [sub, customer])
      await c.query('INSERT INTO subscription_revisions(id,subscription_id,revision,snapshot,quote_id) VALUES($1,$2,1,$3,$4)',
        [revision, sub, JSON.stringify({ period_start: '2026-01-01', period_end: '2026-02-01' }), randomUUID()])
      await c.query('UPDATE subscriptions SET applied_revision_id=$2,state=$3,renewal_at=$4,revision=revision+1 WHERE id=$1', [sub, revision, 'active', '2026-02-01'])
      await c.query(`INSERT INTO orders(id,customer_id,subscription_id,kind,quote_id,target_revision_id,payment_state,fulfillment_state,idempotency_key,request_digest,due_now_minor,currency,exponent)
        VALUES($1,$2,$3,'new',$4,$5,'paid','applied',$6,'fixture',$7,'SAR',2)`, [order, customer, sub, randomUUID(), revision, randomUUID(), total])
      await c.query(`INSERT INTO invoices(id,customer_id,subscription_id,order_id,kind,status,currency,exponent,subtotal_minor,tax_minor,total_minor,period_start,period_end,due_at,paid_at,number)
        VALUES($1,$2,$3,$4,'initial','paid','SAR',2,$5,0,$5,'2026-01-01','2026-02-01',now(),now(),$6)`, [invoice, customer, sub, order, total, `INV-${invoice.slice(0, 8)}`])
      await c.query(`INSERT INTO invoice_lines(id,invoice_id,position,key,kind,timing,description,quantity,unit_minor,amount_minor,currency,exponent,period_start,period_end,source_revision_id)
        VALUES($1,$2,0,'bundle:0','bundle','now','Fixture line',1,$3,$3,'SAR',2,'2026-01-01','2026-02-01',$4)`, [randomUUID(), invoice, total, revision])
      await c.query(`INSERT INTO payment_attempts(id,order_id,invoice_id,provider,mode,provider_ref,amount_minor,currency,exponent,status,succeeded_at,kind)
        VALUES($1,$2,$3,'simulator','simulator',$4,$5,'SAR',2,'succeeded',now(),'hosted_invoice')`, [attempt, order, invoice, created.provider_ref, total])
      await c.query('UPDATE orders SET paid_attempt_id=$2 WHERE id=$1', [order, attempt])
    })
    return { customer, sub, revision, order, invoice, attempt, total, adapter, ref: created.provider_ref, paymentId: created.provider_ref.replace('sim_inv_', 'sim_pay_') }
  }
  type Paid = Awaited<ReturnType<typeof simulatorPaid>>

  const askRefund = (invoice: string) => requestInvoiceRefund(pool, { invoice_id: invoice, actor: operator, reason: 'Customer asked for the money back' })
  const refundRow = async (order: string) => (await pool.query("SELECT id,status,attempts,created_at,next_attempt_at,payload FROM commercial_outbox WHERE kind='reconcile.refund' AND aggregate_id=$1", [order])).rows[0]
  const notes = async (invoice: string) => (await pool.query('SELECT * FROM invoice_adjustments WHERE invoice_id=$1 ORDER BY created_at,id', [invoice])).rows
  const runAgain = async (f: { adapter: SimulatorAdapter; order: string }) => {
    await pool.query('UPDATE commercial_outbox SET next_attempt_at=now() WHERE aggregate_id=$1', [f.order])
    return processRefundOutbox(pool, f.adapter)
  }
  const refundWholePayment = (f: Paid) => f.adapter.refund(f.paymentId, { minor: f.total, currency: 'SAR', exponent: 2 })
  /** Writes `refund_reference` on a settled note of another invoice, so recording this payment's id on a second note breaks the unique index. */
  async function holdReference(reference: string) {
    const other = await simulatorPaid()
    const id = randomUUID()
    await pool.query(`INSERT INTO invoice_adjustments(id,invoice_id,customer_id,kind,reason,amount_minor,currency,exponent,status,created_by,origin,cause,refund_reference,refunded_by,refunded_at)
      VALUES($1,$2,$3,'credit_note','Fixture holder',$4,'SAR',2,'refunded','vendor-test:9','system','provider_refund',$5,'vendor-test:9',now())`, [id, other.invoice, other.customer, other.total, reference])
    return { ...other, note: id }
  }

  /** A vendor-requested refund of a card payment the worker called the provider for, whose outcome it could not verify: the row is marked `attempted`. */
  async function attempted(options: { total?: number } = {}) {
    const f = await simulatorPaid(options)
    const note = await askRefund(f.invoice)
    vi.spyOn(f.adapter, 'refund').mockImplementationOnce(async () => {
      vi.spyOn(f.adapter, 'lookupAttempt').mockRejectedValueOnce(new PaymentError('timeout', 'lookup'))
      throw new PaymentError('timeout', 'refund')
    })
    await processRefundOutbox(pool, f.adapter)
    vi.restoreAllMocks()
    return { ...f, note: note.id }
  }
  /** A vendor-requested refund the provider returned whole, whose recording keeps failing because another note holds the payment id. */
  async function returnedInConflict() {
    const f = await simulatorPaid()
    const note = await askRefund(f.invoice)
    const holder = await holdReference(f.paymentId)
    await processRefundOutbox(pool, f.adapter)
    return { ...f, note: note.id, holder }
  }
  return { simulatorPaid, askRefund, refundRow, notes, runAgain, refundWholePayment, holdReference, attempted, returnedInConflict }
}
