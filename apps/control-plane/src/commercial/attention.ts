import type { Pool } from 'pg'
import { ATTENTION_LIMIT, attentionSchema } from '@nasq/commercial-contracts'

export const RENEWAL_WINDOW_DAYS = 7
export const STALLED_HOURS = 24

const iso = (column: string) => `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')`

// The latest unresolved order mirrors the customers list: stalled means failed, or still queued/applying after STALLED_HOURS.
const subjectsSql = `WITH latest AS (
  SELECT c.id AS customer_id, c.name, c.tenant_id, c.commercial_setup_required, c.created_at AS customer_created_at,
    s.id AS subscription_id, s.state, s.renewal_at, o.fulfillment_state, o.created_at AS order_created_at
  FROM customers c
  LEFT JOIN subscriptions s ON s.customer_id=c.id
  LEFT JOIN LATERAL (
    SELECT fulfillment_state,created_at FROM orders
    WHERE subscription_id=s.id AND NOT cancelled AND fulfillment_state<>'applied'
    ORDER BY created_at DESC,id DESC LIMIT 1
  ) o ON true
), stalled AS (
  SELECT * FROM latest WHERE fulfillment_state IN ('failed','needs_intervention')
    OR (fulfillment_state IN ('queued','applying') AND order_created_at < now() - make_interval(hours => $1::int))
), setup AS (
  SELECT * FROM latest WHERE commercial_setup_required OR subscription_id IS NULL
), renewing AS (
  SELECT * FROM latest WHERE state IN ('active','trialing') AND renewal_at BETWEEN current_date AND current_date + $2::int
), overdue AS (
  SELECT DISTINCT ON (i.customer_id) i.customer_id, i.id AS invoice_id, i.due_at, c.name, c.tenant_id
  FROM invoices i JOIN customers c ON c.id=i.customer_id
  WHERE i.status='issued' AND i.due_at < now()
  ORDER BY i.customer_id, i.due_at, i.id
), failed_ops AS (
  SELECT DISTINCT ON (op.tenant_id) op.id, op.tenant_id, op.type, op.updated_at, t.name, c.id AS customer_id
  FROM operations op JOIN tenants t ON t.id=op.tenant_id LEFT JOIN customers c ON c.tenant_id=op.tenant_id
  WHERE op.status IN ('failed','needs_intervention')
    AND NOT EXISTS (SELECT 1 FROM operations later WHERE later.tenant_id=op.tenant_id AND later.created_at>op.created_at AND later.status='succeeded')
  ORDER BY op.tenant_id, op.created_at DESC, op.id
), subjects AS (
  SELECT 1 AS rank,'past_due' AS kind, customer_id, tenant_id, NULL::uuid AS operation_id, invoice_id, name, ${iso('due_at')} AS since, NULL::text AS detail, due_at AS sort_at FROM overdue WHERE $3::boolean
  UNION ALL SELECT 2,'stalled_activation', customer_id, tenant_id, NULL, NULL, name, ${iso('order_created_at')}, fulfillment_state, order_created_at FROM stalled
  UNION ALL SELECT 3,'operation_failed', customer_id, tenant_id, id, NULL, name, ${iso('updated_at')}, type, updated_at FROM failed_ops
  UNION ALL SELECT 4,'setup_required', customer_id, tenant_id, NULL, NULL, name, ${iso('customer_created_at')}, NULL, customer_created_at FROM setup
  UNION ALL SELECT 5,'renewal_soon', customer_id, tenant_id, NULL, NULL, name, ${iso('renewal_at::timestamptz')}, NULL, renewal_at::timestamptz FROM renewing
)`

const countsSql = `SELECT
  (SELECT count(*)::int FROM subscriptions WHERE state IN ('active','trialing')) AS subscriptions_active,
  (SELECT count(*)::int FROM subscriptions WHERE state='pending') AS subscriptions_pending,
  (SELECT count(*)::int FROM subscriptions WHERE state='past_due') AS past_due,
  (SELECT count(*)::int FROM customers c JOIN subscriptions s ON s.customer_id=c.id JOIN LATERAL (
     SELECT fulfillment_state,created_at FROM orders WHERE subscription_id=s.id AND NOT cancelled AND fulfillment_state<>'applied'
     ORDER BY created_at DESC,id DESC LIMIT 1) o ON true
   WHERE o.fulfillment_state IN ('failed','needs_intervention')
     OR (o.fulfillment_state IN ('queued','applying') AND o.created_at < now() - make_interval(hours => $1::int))) AS stalled,
  (SELECT count(*)::int FROM customers c LEFT JOIN subscriptions s ON s.customer_id=c.id WHERE c.commercial_setup_required OR s.id IS NULL) AS setup_required,
  (SELECT count(*)::int FROM subscriptions WHERE state IN ('active','trialing') AND renewal_at BETWEEN current_date AND current_date + $2::int) AS renewals`

/** GET /v1/commercial/attention (vendor.read): a bounded, prioritized list of what needs the vendor today. Overdue invoices are billing detail: only `includeBilling` callers get them. */
export async function attention(pool: Pool, includeBilling: boolean) {
  const params = [STALLED_HOURS, RENEWAL_WINDOW_DAYS, includeBilling]
  const [list, counts] = await Promise.all([
    pool.query(`${subjectsSql}
      SELECT (SELECT count(*)::int FROM subjects) AS total,
        COALESCE((SELECT jsonb_agg(to_jsonb(p)-'rank'-'sort_at' ORDER BY p.rank,p.sort_at,p.customer_id,p.tenant_id)
          FROM (SELECT * FROM subjects ORDER BY rank,sort_at,customer_id,tenant_id LIMIT ${ATTENTION_LIMIT}) p),'[]'::jsonb) AS items`, params),
    pool.query(countsSql, params.slice(0, 2)),
  ])
  return attentionSchema.parse({ items: list.rows[0].items, total: list.rows[0].total, counts: counts.rows[0] })
}
