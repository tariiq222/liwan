import type { Pool } from 'pg'
import { subscriptionViewSchema, subscriptionRevisionSchema, subscriptionDisplayState } from '@liwan/commercial-contracts'
import { CommercialHttpError } from './lifecycle.js'
import { orderView } from './orders.js'

const iso = (value: Date | string | null): string | null => value === null ? null : value instanceof Date ? value.toISOString() : value
const date = (value: Date | string | null): string | null => iso(value)?.slice(0, 10) ?? null

/** The applied snapshot is the only source of effective customer entitlements. */
export async function getSubscription(pool: Pool, customerId: string) {
  const result = await pool.query('SELECT * FROM subscriptions WHERE customer_id=$1', [customerId])
  if (!result.rowCount) throw new CommercialHttpError('not_found', 404)
  const row = result.rows[0]
  const revisions = await pool.query('SELECT * FROM subscription_revisions WHERE id=ANY($1::uuid[])', [[row.applied_revision_id, row.target_revision_id].filter(Boolean)])
  const revision = (id: string | null) => {
    const r = revisions.rows.find(r => r.id === id)
    if (!r) return null
    const { pricing: _pricing, branch_archive_ids: _archives, ...snapshot } = r.snapshot
    return subscriptionRevisionSchema.parse({ ...snapshot, id: r.id, subscription_id: r.subscription_id, revision: r.revision, quote_id: r.quote_id, created_at: iso(r.created_at) })
  }
  const pending = await pool.query("SELECT * FROM orders WHERE subscription_id=$1 AND NOT cancelled AND fulfillment_state<>'applied' ORDER BY created_at DESC,id DESC LIMIT 1", [row.id])
  const view = subscriptionViewSchema.parse({
    id: row.id, customer_id: row.customer_id, tenant_id: row.tenant_id, state: row.state,
    applied: revision(row.applied_revision_id), target: revision(row.target_revision_id), pending_order: pending.rows[0] ? orderView(pending.rows[0]) : null,
    revision: row.revision, renewal_at: date(row.renewal_at),
    auto_renew: { enabled: row.auto_renew_enabled, consent_at: iso(row.auto_renew_consent_at), token_ref_present: Boolean(row.provider_token_ref) },
    trial_ends_at: iso(row.trial_ends_at), grace_ends_at: iso(row.grace_ends_at),
  })
  // Consumers derive the display state without confusing paid with applied.
  subscriptionDisplayState(view)
  return view
}
