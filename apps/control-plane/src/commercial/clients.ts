import type { Pool } from 'pg'
import { CLIENT_LIST_PAGE_SIZE, clientListSchema, clientStateFilterSchema } from '@liwan/commercial-contracts'
import { CommercialHttpError } from './lifecycle.js'

// One row per customer (with its workspace, when provisioned) plus one row per workspace without a customer.
// `pending_plan_name` is the plan of the latest unresolved order (shown while it waits for activation).
// The display state mirrors subscriptionDisplayState and the customers list, using the latest unresolved order.
const rowsSql = `WITH client_rows AS (
  SELECT c.id AS customer_id, c.tenant_id, c.name, c.created_at, c.id AS row_key,
    CASE
      WHEN s.id IS NULL THEN NULL
      WHEN o.fulfillment_state IN ('failed','needs_intervention') THEN 'failed'
      WHEN o.payment_state IN ('awaiting_payment','failed') THEN 'awaiting_payment'
      WHEN o.payment_state IN ('refund_pending','refunded') THEN 'failed'
      WHEN o.id IS NOT NULL THEN 'activating'
      WHEN s.state IN ('suspended','cancelled') THEN 'inactive'
      WHEN s.state='pending' AND s.applied_revision_id IS NULL AND EXISTS (SELECT 1 FROM orders x WHERE x.subscription_id=s.id AND x.cancelled) THEN 'inactive'
    WHEN s.state='pending' AND s.applied_revision_id IS NULL THEN 'awaiting_payment'
      WHEN s.state='pending' OR s.applied_revision_id IS NULL THEN 'activating'
      ELSE 'active' END AS subscription_state,
    p.name AS plan_name, pp.name AS pending_plan_name, to_char(s.renewal_at,'YYYY-MM-DD') AS renewal_at,
    c.commercial_setup_required AS setup_required,
    (c.commercial_setup_required OR s.id IS NULL) AS needs_setup,
    t.status AS tenant_status, t.commercial_mode, t.hosting_model
  FROM customers c
  LEFT JOIN tenants t ON t.id=c.tenant_id
  LEFT JOIN subscriptions s ON s.customer_id=c.id
  LEFT JOIN LATERAL (
    SELECT id,payment_state,fulfillment_state,target_revision_id FROM orders
    WHERE subscription_id=s.id AND NOT cancelled AND fulfillment_state<>'applied'
    ORDER BY created_at DESC,id DESC LIMIT 1
  ) o ON true
  LEFT JOIN subscription_revisions r ON r.id=s.applied_revision_id
  LEFT JOIN plan_revisions p ON p.id::text=r.snapshot->>'plan_revision_id'
  LEFT JOIN subscription_revisions tr ON tr.id=o.target_revision_id
  LEFT JOIN plan_revisions pp ON pp.id::text=tr.snapshot->>'plan_revision_id'
  UNION ALL
  SELECT NULL::uuid, t.id, t.name, t.created_at, t.id,
    NULL, NULL, NULL, NULL, false, false, t.status, t.commercial_mode, t.hosting_model
  FROM tenants t
  WHERE NOT EXISTS (SELECT 1 FROM customers c WHERE c.tenant_id=t.id)
), filtered AS (
  SELECT * FROM client_rows
  WHERE ($1='' OR strpos(lower(name),lower($1))>0)
    AND ($2::text IS NULL OR CASE $2
      WHEN 'setup_required' THEN needs_setup
      WHEN 'no_workspace' THEN customer_id IS NOT NULL AND tenant_id IS NULL
      WHEN 'no_commercial' THEN customer_id IS NULL
      ELSE subscription_state=$2 END)
)`

/** GET /v1/commercial/clients?q&state&page (vendor.read): the unified client list, 25 per page, newest first. */
export async function listClients(pool: Pool, url: URL) {
  const q = (url.searchParams.get('q') ?? '').trim()
  if (q.length > 200) throw new CommercialHttpError('invalid', 422, 'q')
  const stateParam = url.searchParams.get('state')
  const state = stateParam === null ? null : clientStateFilterSchema.safeParse(stateParam)
  if (state && !state.success) throw new CommercialHttpError('invalid', 422, 'state')
  const pageParam = url.searchParams.get('page') ?? '1'
  if (!/^\d+$/.test(pageParam) || Number(pageParam) < 1 || Number(pageParam) > 1_000_000) throw new CommercialHttpError('invalid', 422, 'page')
  const result = await pool.query(`${rowsSql}
    SELECT (SELECT count(*)::int FROM filtered) AS total,
      COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'customer_id',p.customer_id,'tenant_id',p.tenant_id,'name',p.name,'subscription_state',p.subscription_state,
          'plan_name',p.plan_name,'pending_plan_name',p.pending_plan_name,'renewal_at',p.renewal_at,'setup_required',p.setup_required,
          'tenant_status',p.tenant_status,'commercial_mode',p.commercial_mode,'hosting_model',p.hosting_model
        ) ORDER BY p.created_at DESC,p.row_key)
        FROM (SELECT * FROM filtered ORDER BY created_at DESC,row_key LIMIT $3 OFFSET $4) p), '[]'::jsonb) AS items`,
  [q, state?.data ?? null, CLIENT_LIST_PAGE_SIZE, (Number(pageParam) - 1) * CLIENT_LIST_PAGE_SIZE])
  return clientListSchema.parse(result.rows[0])
}
