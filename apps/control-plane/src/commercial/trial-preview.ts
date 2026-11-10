import type { Pool } from 'pg'
import { riyadhDate, trialEndPreviewSchema, type TrialEndPreview } from '@liwan/commercial-contracts'
import { keptAtTrialEnd } from './free-base.js'
import { getUsage } from './usage.js'
import { CommercialHttpError } from './lifecycle.js'

const MB = 1024 * 1024

export async function trialEndPreview(pool: Pool, customerId: string, now = new Date()): Promise<TrialEndPreview> {
  const row = (await pool.query(`SELECT s.*,l.state AS lapse_state,l.ended_at,l.period_start::text AS lapse_start,
      l.next_attempt_at,l.force_empty,l.kept,l.order_id,
      r.snapshot,old.snapshot AS before_lapse
    FROM subscriptions s JOIN subscription_revisions r ON r.id=s.applied_revision_id
    LEFT JOIN trial_lapses l ON l.subscription_id=s.id
    LEFT JOIN subscription_revisions old ON old.id=l.trial_revision_id WHERE s.customer_id=$1`, [customerId])).rows[0]
  const cutoff = row?.ended_at ?? row?.trial_ended_at ?? row?.trial_ends_at
  if (!cutoff) throw new CommercialHttpError('trial_not_active', 404)
  const settled = row.lapse_state === 'done' || row.trial_outcome === 'converted'
  const status = settled ? 'settled' : row.lapse_state ? 'lock_pending' : new Date(cutoff) <= now ? 'trial_ending' : 'trialing'
  const start = row.lapse_start ?? riyadhDate(cutoff)
  const snapshot = row.before_lapse ?? row.snapshot
  const lock = await keptAtTrialEnd(pool, { subscription: row, snapshot, cutoff, start, forceEmpty: row.force_empty })
  const kept = row.kept?.kept ?? lock.ledger.kept
  const usage = await getUsage(pool, { tenant_id: row.tenant_id, now, limits: {
    'users.limit': lock.quote.requested_users, 'storage.limit_mb': lock.quote.requested_storage_mb,
  } })
  const firstOrder = settled ? (await pool.query(`SELECT q.payload FROM renewals rr JOIN orders o ON o.id=rr.order_id
    JOIN commercial_quotes q ON q.id=o.quote_id WHERE rr.subscription_id=$1 AND rr.period_start=$2 AND NOT o.cancelled`,
  [row.id, start])).rows[0]?.payload : null
  const users = usage.metrics.find(metric => metric.key === 'users.limit')?.used
  const available = usage.freshness === 'fresh'
  const sample = available ? (await pool.query(`SELECT excess,metrics->'attachment_bytes' AS storage_bytes FROM usage_snapshots
    WHERE tenant_id=$1 AND observed_at=$2 ORDER BY id DESC LIMIT 1`, [row.tenant_id, usage.observed_at])).rows[0] : null
  const storageBytes = typeof sample?.storage_bytes === 'number' ? sample.storage_bytes : null
  const observed = sample?.excess
  // Observed usage is the full-access count. Seats already read-only also consume a position in the preview.
  const totalUsers = users == null ? null : users + Number(observed?.['users.limit'] ?? 0)
  const invoice = row.trial_outcome === 'converted' ? firstOrder : firstOrder ?? lock.quote
  return trialEndPreviewSchema.parse({
    status, trial_ends_at: new Date(cutoff).toISOString(), outcome: settled ? row.trial_outcome : null,
    kept, locked_bundle_revision_ids: row.trial_outcome === 'converted' ? [] : snapshot.bundle_revision_ids.filter((id: string) => !lock.quote.bundle_revision_ids.includes(id)),
    limits: { users: lock.quote.requested_users, storage_mb: lock.quote.requested_storage_mb, extra_branches: lock.quote.requested_extra_branches },
    excess: {
      users: available && totalUsers != null ? Math.max(0, totalUsers - lock.quote.requested_users) : null,
      storage_bytes: storageBytes == null ? null : Math.max(0, storageBytes - lock.quote.requested_storage_mb * MB),
      extra_branches: Math.max(0, lock.liveBranches - lock.quote.requested_extra_branches),
      sampled_at: usage.observed_at, source: available ? 'usage_snapshot' : 'unavailable', item_details: 'unavailable',
    },
    first_invoice: invoice?.due_now.minor ? invoice : null,
    next_attempt_at: !settled && row.next_attempt_at ? new Date(row.next_attempt_at).toISOString() : null,
  })
}
