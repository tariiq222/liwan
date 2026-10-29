import { z } from 'zod'
import type { Pool } from 'pg'
import { CommercialHttpError } from './lifecycle.js'
import { getSubscription } from './subscriptions.js'

// Match subscriptionDisplayState, using the same latest unresolved order as
// getSubscription. Filter/count in SQL before slicing; hydrate only this page.
const statesSql = `WITH customer_states AS (
  SELECT c.*, CASE
    WHEN c.commercial_setup_required OR s.id IS NULL THEN 'setup_required'
    WHEN o.fulfillment_state IN ('failed','needs_intervention') THEN 'failed'
    WHEN o.payment_state IN ('awaiting_payment','failed') THEN 'awaiting_payment'
    WHEN o.payment_state IN ('refund_pending','refunded') THEN 'failed'
    WHEN o.id IS NOT NULL THEN 'activating'
    WHEN s.state IN ('suspended','cancelled') THEN 'inactive'
    WHEN s.state='pending' AND s.applied_revision_id IS NULL THEN 'inactive'
    WHEN s.state='pending' OR s.applied_revision_id IS NULL THEN 'activating'
    ELSE 'active' END AS display_state
  FROM customers c
  LEFT JOIN subscriptions s ON s.customer_id=c.id
  LEFT JOIN LATERAL (
    SELECT id,payment_state,fulfillment_state FROM orders
    WHERE subscription_id=s.id AND NOT cancelled AND fulfillment_state<>'applied'
    ORDER BY created_at DESC,id DESC LIMIT 1
  ) o ON true
  WHERE ($1='' OR strpos(lower(c.name),lower($1))>0)
    AND ($3::uuid IS NULL OR c.tenant_id=$3::uuid)
), filtered AS (SELECT * FROM customer_states WHERE ($2::text IS NULL OR display_state=$2))`

function integer(url: URL, field: string, fallback: number, min: number, max: number): number {
  const raw = url.searchParams.get(field)
  if (raw === null) return fallback
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < min || Number(raw) > max)
    throw new CommercialHttpError('invalid', 422, field)
  return Number(raw)
}

export async function customerView(pool: Pool, customer: Record<string, any>) {
  const subscription = await getSubscription(pool, customer.id).catch(e => {
    if (e instanceof CommercialHttpError && e.status === 404) return null
    throw e
  })
  return { ...customer, subscription }
}

export async function listCustomers(pool: Pool, url: URL) {
  const limit = integer(url, 'limit', 200, 1, 200)
  const offset = integer(url, 'offset', 0, 0, Number.MAX_SAFE_INTEGER)
  const q = (url.searchParams.get('q') ?? '').trim()
  if (q.length > 200) throw new CommercialHttpError('invalid', 422, 'q')
  const state = url.searchParams.get('state')
  if (state !== null && !['awaiting_payment','activating','active','failed','inactive','setup_required'].includes(state))
    throw new CommercialHttpError('invalid', 422, 'state')
  const tenantId = url.searchParams.get('tenant_id')
  if (tenantId !== null && !z.uuid().safeParse(tenantId).success) throw new CommercialHttpError('invalid', 422, 'tenant_id')
  // Count and page share one statement/snapshot; an empty page still has a total.
  const result = await pool.query(`${statesSql}
    SELECT (SELECT count(*)::int FROM filtered) AS total,
      COALESCE((SELECT jsonb_agg(p ORDER BY p.created_at DESC,p.id)
        FROM (SELECT * FROM filtered ORDER BY created_at DESC,id LIMIT $4 OFFSET $5) p), '[]'::jsonb) AS items`,
  [q, state, tenantId, limit, offset])
  const row = result.rows[0]
  return { items: await Promise.all(row.items.map((customer: Record<string, any>) => customerView(pool, customer))), total: row.total as number }
}
