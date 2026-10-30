import type { Pool } from 'pg'
import { pricingPolicySchema, type PricingPolicy } from '@liwan/commercial-contracts'
import { CommercialHttpError } from './lifecycle.js'

export function policyWire(row: Record<string, any>): PricingPolicy {
  return pricingPolicySchema.parse({
    id: row.id, timezone: row.timezone, rounding: row.rounding,
    tax: row.tax_kind === 'vat_exclusive' ? { kind: 'vat_exclusive', rate_bps: row.tax_rate_bps } : { kind: 'none' },
  })
}
export async function listPolicies(pool: Pool) {
  const r = await pool.query("SELECT * FROM pricing_policy_revisions WHERE status='approved' ORDER BY created_at,id")
  return { items: r.rows.map(policyWire), total: r.rowCount ?? 0 }
}
export async function getPolicy(pool: Pool, id: string): Promise<PricingPolicy> {
  const r = await pool.query("SELECT * FROM pricing_policy_revisions WHERE id=$1 AND status='approved'", [id])
  if (!r.rowCount) throw new CommercialHttpError('policy_missing', 404)
  return policyWire(r.rows[0])
}
