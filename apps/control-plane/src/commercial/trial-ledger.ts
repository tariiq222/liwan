import type { PoolClient } from 'pg'
import { fitsStorageSteps, type PlanRevision } from '@liwan/commercial-contracts'
import type { PaidThrough, QuoteCurrent } from '@liwan/commercial-contracts/server'
import { creditedMinorSql } from './refund-credit.js'

export type PaidTrialLine = { key: string; quantity: number; through: string; order_id: string }

export async function paidTrialLines(client: Pick<PoolClient, 'query'>, subscriptionId: string, cutoff: Date): Promise<PaidTrialLine[]> {
  return (await client.query(`SELECT left(l.key,-6) AS key,l.quantity::int,l.period_end::text AS through,o.id AS order_id
    FROM orders o JOIN invoices i ON i.order_id=o.id JOIN invoice_lines l ON l.invoice_id=i.id
    WHERE o.subscription_id=$1 AND o.created_at<=$2 AND o.kind IN ('change','branch_add','branch_restore')
      AND o.payment_state='paid' AND o.due_now_minor>0 AND NOT o.cancelled
      AND o.fulfillment_state IN ('queued','applying','applied','needs_intervention','failed')
      AND i.total_minor>${creditedMinorSql('i.id')} AND l.timing='now' AND l.amount_minor>0 AND l.key LIKE '%:delta'
    ORDER BY l.period_end DESC,l.id`, [subscriptionId, cutoff])).rows
}

export function trialLedger(lines: PaidTrialLine[], applied: QuoteCurrent, plan: PlanRevision, livePaidBranches: number) {
  const paid_through: PaidThrough = {}
  const orders = new Set<string>()
  const take = (key: string, ceiling: number) => {
    let quantity = 0
    for (const line of lines) {
      if (line.key !== key || quantity >= ceiling) continue
      const units = Math.min(line.quantity, ceiling - quantity)
      if (units <= 0) continue
      quantity += units
      orders.add(line.order_id)
      const coverage = paid_through[key] ??= []
      coverage.push({ quantity: units, through: line.through })
    }
    return quantity
  }
  const bundle_revision_ids = applied.bundle_revision_ids.filter(id => !plan.included_bundle_revision_ids.includes(id) && take(`bundle:${id}`, 1))
  const storage = Math.min(applied.paid_storage_gb, lines.filter(l => l.key === 'storage').reduce((sum, l) => sum + l.quantity, 0))
  const step = storage * 1024 < plan.storage_step_threshold_mb ? plan.storage_step_mb : plan.storage_large_step_mb
  const validStorage = fitsStorageSteps(storage * 1024, plan) ? storage : Math.floor(storage * 1024 / step) * step / 1024
  const kept = {
    bundle_revision_ids,
    paid_users: take('users', applied.paid_users),
    paid_storage_gb: take('storage', validStorage),
    paid_extra_branches: take('branch', Math.min(applied.paid_extra_branches, livePaidBranches)),
  }
  return { kept, paid_through, order_ids: [...orders] }
}
