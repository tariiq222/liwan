import { describe, expect, it } from 'vitest'
import type { PlanRevision } from '@liwan/commercial-contracts'
import type { QuoteCurrent } from '@liwan/commercial-contracts/server'
import { trialLedger, type PaidTrialLine } from '../commercial/trial-ledger.js'

describe('paid trial ledger', () => {
  const plan = { included_bundle_revision_ids: [], storage_step_mb: 10240, storage_step_threshold_mb: 102400, storage_large_step_mb: 102400 } as unknown as PlanRevision
  const applied = { bundle_revision_ids: ['kept', 'unpaid'], paid_users: 4, paid_storage_gb: 200, paid_extra_branches: 2 } as QuoteCurrent
  const line = (key: string, quantity: number): PaidTrialLine => ({ key, quantity, through: '2026-11-20', order_id: key })

  it('adds eligible purchases, clamps to the applied config and rounds storage down (L1, L8)', () => {
    const lines = [line('bundle:kept', 1), line('bundle:removed', 1), line('users', 2), line('users', 3), line('storage', 110), line('branch', 2)]
    expect(trialLedger(lines, applied, plan, 1)).toMatchObject({
      kept: { bundle_revision_ids: ['kept'], paid_users: 4, paid_storage_gb: 100, paid_extra_branches: 1 },
      paid_through: { storage: [{ quantity: 100, through: '2026-11-20' }] },
    })
  })

  it('never keeps more than purchased or still applied across successive changes', () => {
    for (let total = 0; total < 15; total++) {
      for (let left = 0; left < 15; left++) {
        const orders = Array.from({ length: total }, (_, index) => ({ ...line('users', 1), order_id: String(index) }))
        const result = trialLedger(orders, { ...applied, paid_users: left }, plan, 0)
        expect(result.kept.paid_users).toBe(Math.min(total, left))
        expect(result.order_ids).toHaveLength(result.kept.paid_users)
      }
    }
  })
})
