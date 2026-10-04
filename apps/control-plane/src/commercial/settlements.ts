import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { transaction } from '../db.js'
import { audit, type CommercialActor } from './lifecycle.js'
import type { PaymentAdapter } from './payment-adapter.js'

/** Late payment is a manual credit review, never an automatic provider refund. */
export async function processRefundOutbox(pool: Pool, _adapter?: PaymentAdapter): Promise<number> {
  return transaction(pool, async client => {
    const rows = (await client.query("SELECT * FROM commercial_outbox WHERE kind='reconcile.refund' AND status='pending' ORDER BY created_at,id FOR UPDATE SKIP LOCKED")).rows
    const reason = 'payment after cancellation — manual review'
    for (const row of rows) {
      // Lock invoices too: separate event ids can refer to the same invoice.
      const invoices = (await client.query('SELECT * FROM invoices WHERE order_id=$1 ORDER BY id FOR UPDATE', [row.aggregate_id])).rows
      for (const invoice of invoices) {
        const existing = await client.query('SELECT id FROM invoice_adjustments WHERE invoice_id=$1 AND reason=$2', [invoice.id,reason])
        if (!existing.rowCount) await client.query(`INSERT INTO invoice_adjustments(id,invoice_id,customer_id,kind,reason,amount_minor,currency,exponent,status,created_by)
          VALUES($1,$2,$3,'credit_note',$4,$5,$6,$7,'pending','system')`,
        [randomUUID(),invoice.id,invoice.customer_id,reason,invoice.total_minor,invoice.currency,invoice.exponent])
      }
      await client.query("UPDATE commercial_outbox SET status='done',processed_at=now() WHERE id=$1", [row.id])
    }
    return rows.length
  })
}

/** Caller owns the transaction. Paid invoices and their lines are never erased. */
export async function recordFulfillmentFailure(client: PoolClient, { order_id, reason, actor }: {
  order_id: string; reason: string; actor: CommercialActor | string
}) {
  if (reason.trim().length < 3) throw new Error('reason_required')
  const invoices = await client.query("UPDATE invoices SET status='credit_pending' WHERE order_id=$1 AND status='paid' RETURNING *", [order_id])
  const ids: string[] = []
  for (const invoice of invoices.rows) {
    const id = randomUUID()
    await client.query(`INSERT INTO invoice_adjustments(id,invoice_id,customer_id,kind,reason,amount_minor,currency,exponent,status,created_by)
      VALUES($1,$2,$3,'credit_note',$4,$5,$6,$7,'pending',$8)`,
    [id,invoice.id,invoice.customer_id,reason,invoice.total_minor,invoice.currency,invoice.exponent,
      typeof actor === 'string' ? actor : `${actor.issuer}:${actor.actorUid}`])
    ids.push(id)
  }
  if (ids.length && typeof actor !== 'string') await audit(client, actor, 'invoice.credit_pending', order_id, reason, { adjustment_ids: ids })
  return ids
}
