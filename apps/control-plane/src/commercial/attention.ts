import type { Pool } from 'pg'
import { ATTENTION_LIMIT, attentionSchema } from '@liwan/commercial-contracts'
import { creditedMinorSql } from './refund-credit.js'
import { EXPIRY_CLEARING_REASON, expiryClearingJob } from './expiry-push.js'
import { holdsTrialAfterLapseSql, owesAtRenewalSql } from './free-base.js'

export const RENEWAL_WINDOW_DAYS = 7
export const STALLED_HOURS = 24
/** Renewal dates are calendar dates of the business, so "today" and the renewal instant are read in this zone, never the session's. */
export const BUSINESS_TIME_ZONE = 'Asia/Riyadh'

const businessToday = `(now() AT TIME ZONE '${BUSINESS_TIME_ZONE}')::date`
const renewalInstant = `(renewal_at::timestamp AT TIME ZONE '${BUSINESS_TIME_ZONE}')`
// Due soon or already missed: a renewal date that passed without renewing stays here until it is dealt with.
// A renewal that is deliberately skipped (an unresolved lapse) or owes nothing (the free base) is never due.
const renewalSkipped = `(${holdsTrialAfterLapseSql('s')} OR NOT ${owesAtRenewalSql(`(SELECT r.snapshot->'pricing' FROM subscription_revisions r WHERE r.id=s.applied_revision_id)`)})`
const renewalDue = `state IN ('active','trialing') AND renewal_at <= ${businessToday} + $2::int AND NOT renewal_skipped`

const iso = (column: string) => `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')`

// The latest unresolved order mirrors the customers list: stalled means failed, or still queued/applying after STALLED_HOURS.
const subjectsSql = `WITH latest AS (
  SELECT c.id AS customer_id, c.name, c.tenant_id, c.commercial_setup_required, c.created_at AS customer_created_at,
    s.id AS subscription_id, s.state, s.renewal_at, s.billing_blocked_at, ${renewalSkipped} AS renewal_skipped, o.fulfillment_state, o.created_at AS order_created_at
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
), rejected_refunds AS (
  -- A refund the worker closed as failed. It leaves the list once the invoice's credit covers it, by the same
  -- definition of "credited" the worker uses (any non-void note, any origin): the figure the provider gave when it is
  -- valid (at most the payment), otherwise any credit at all, or when a later event for the attempt was processed.
  -- A row with no attempt has no invoice to be covered on and stays; no operator action dismisses it.
  SELECT DISTINCT ON (r.aggregate_id) r.aggregate_id, r.processed_at, r.payload->>'error' AS reason, r.invoice_id,
    o.customer_id, COALESCE(c.name, r.aggregate_id) AS name, c.tenant_id
  FROM (
    SELECT ob.aggregate_id, ob.processed_at, ob.created_at, ob.payload, a.id AS attempt_id, a.invoice_id,
      a.amount_minor AS paid_minor,
      CASE WHEN a.currency = ob.payload#>>'{refunded,currency}' AND ob.payload#>>'{refunded,minor}' ~ '^[0-9]{1,15}$'
        THEN (ob.payload#>>'{refunded,minor}')::bigint END AS refunded_minor,
      CASE WHEN a.id IS NOT NULL THEN ${creditedMinorSql('a.invoice_id')} END AS credited_minor
    FROM commercial_outbox ob
    LEFT JOIN payment_attempts a ON a.id::text = ob.payload->>'attempt_id'
    WHERE ob.kind IN ('payment.intervention','reconcile.refund') AND ob.status='failed' AND ob.payload ? 'error'
  ) r
  LEFT JOIN orders o ON o.id::text = r.aggregate_id
  LEFT JOIN customers c ON c.id = o.customer_id
  WHERE r.attempt_id IS NULL OR NOT (
    COALESCE(r.credited_minor >= CASE WHEN r.refunded_minor > 0 THEN LEAST(r.refunded_minor, r.paid_minor) ELSE 1 END, false)
    OR EXISTS (SELECT 1 FROM commercial_outbox later WHERE later.kind = 'payment.intervention' AND later.status = 'done'
      AND later.payload->>'attempt_id' = r.attempt_id::text AND later.created_at > r.created_at))
  ORDER BY r.aggregate_id, r.processed_at DESC
), blocked AS (
  SELECT * FROM latest WHERE billing_blocked_at IS NOT NULL AND state IN ('active','past_due')
), lowering AS (
  -- A trial that lapsed onto the free base but could not be lowered yet: the tenant is usable (its hard expiry is already
  -- cleared); reason is the machine reason of the last attempt. It clears the moment the customer's own order is applied.
  -- Until the lock is applied the trial's hard expiry in Odoo must also be cleared, or Odoo locks the WHOLE company after the
  -- grace period: a clearing job that needs intervention (or was closed after a refusal) is shown from the job itself, so it
  -- disappears the moment the job is verified.
  SELECT c.id AS customer_id, c.name, c.tenant_id, l.lapsed_at, COALESCE(l.reason, stuck.reason) AS reason FROM trial_lapses l
  JOIN subscriptions s ON s.id=l.subscription_id AND s.applied_revision_id=l.trial_revision_id JOIN customers c ON c.id=s.customer_id
  LEFT JOIN LATERAL (
    SELECT '${EXPIRY_CLEARING_REASON}:' || COALESCE(latest_job.journal->>'error_code', latest_job.state) AS reason FROM (
      SELECT j.state, j.journal FROM shared_jobs j
      WHERE l.state IN ('pending','ordered') AND ${expiryClearingJob('j', 's.tenant_id', 'l.trial_revision_id')}
      ORDER BY j.created_at DESC, j.id DESC LIMIT 1
    ) latest_job WHERE latest_job.state IN ('needs_intervention','failed')
  ) stuck ON true
  WHERE l.state IN ('pending','ordered') AND COALESCE(l.reason, stuck.reason) IS NOT NULL
), renewal_failures AS (
  -- A renewal that failed for this subscription alone (the others kept renewing): the machine reason of the last failure.
  SELECT c.id AS customer_id, c.name, c.tenant_id, s.renewal_failed_at, s.renewal_failure FROM subscriptions s JOIN customers c ON c.id=s.customer_id
  WHERE s.renewal_failure IS NOT NULL
), holding AS (
  -- The calm, persistent state after the lock: the customer keeps users or storage above what the plan includes (the explicit
  -- held marker) or extra branches above the included ones, free until they name a quantity or buy a branch. Nothing here needs
  -- the vendor now; it is the list to follow up commercially. detail says what is held, and the item goes when nothing is.
  SELECT c.id AS customer_id, c.name, c.tenant_id, l.lapsed_at,
    concat_ws(',', (SELECT string_agg(e.key||':'||(e.value->>'held')||'>'||(e.value->>'target'), ',' ORDER BY e.key) FROM jsonb_each(COALESCE(r.snapshot->'held_ceilings','{}'::jsonb)) AS e WHERE e.key IN ('users.limit','storage.limit_mb')),
      CASE WHEN b.n > (r.snapshot->>'included_extra_branches')::int THEN 'branches.extra:'||b.n||'>'||(r.snapshot->>'included_extra_branches') END) AS detail
  FROM trial_lapses l JOIN subscriptions s ON s.id=l.subscription_id JOIN customers c ON c.id=s.customer_id
  JOIN subscription_revisions r ON r.id=s.applied_revision_id
  CROSS JOIN LATERAL (SELECT count(*)::int AS n FROM commercial_branches cb WHERE cb.subscription_id=s.id AND cb.kind='extra' AND cb.state IN ('active','pending')) b
  WHERE l.state='done'
), renewing AS (
  SELECT * FROM latest WHERE ${renewalDue}
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
  UNION ALL SELECT 2,'refund_rejected', customer_id, tenant_id, NULL, invoice_id, name, ${iso('processed_at')}, reason, processed_at FROM rejected_refunds WHERE $3::boolean
  UNION ALL SELECT 3,'billing_blocked', customer_id, tenant_id, NULL, NULL, name, ${iso('billing_blocked_at')}, NULL, billing_blocked_at FROM blocked
  UNION ALL SELECT 3,'free_base_blocked', customer_id, tenant_id, NULL, NULL, name, ${iso('lapsed_at')}, reason, lapsed_at FROM lowering
  UNION ALL SELECT 3,'renewal_failed', customer_id, tenant_id, NULL, NULL, name, ${iso('renewal_failed_at')}, renewal_failure, renewal_failed_at FROM renewal_failures
  UNION ALL SELECT 9,'free_base_holding', customer_id, tenant_id, NULL, NULL, name, ${iso('lapsed_at')}, detail, lapsed_at FROM holding WHERE detail <> ''
  UNION ALL SELECT 4,'stalled_activation', customer_id, tenant_id, NULL, NULL, name, ${iso('order_created_at')}, fulfillment_state, order_created_at FROM stalled
  UNION ALL SELECT 5,'operation_failed', customer_id, tenant_id, id, NULL, name, ${iso('updated_at')}, type, updated_at FROM failed_ops
  UNION ALL SELECT 6,'setup_required', customer_id, tenant_id, NULL, NULL, name, ${iso('customer_created_at')}, NULL, customer_created_at FROM setup
  UNION ALL SELECT 7,'renewal_missed', customer_id, tenant_id, NULL, NULL, name, ${iso(renewalInstant)}, NULL, ${renewalInstant} FROM renewing WHERE renewal_at < ${businessToday}
  UNION ALL SELECT 8,'renewal_soon', customer_id, tenant_id, NULL, NULL, name, ${iso(renewalInstant)}, NULL, ${renewalInstant} FROM renewing WHERE renewal_at >= ${businessToday}
)`

const countsSql = `SELECT
  (SELECT count(*)::int FROM subscriptions WHERE state IN ('active','trialing')) AS subscriptions_active,
  (SELECT count(*)::int FROM subscriptions WHERE state='pending') AS subscriptions_pending,
  (SELECT CASE WHEN $3::boolean THEN count(DISTINCT customer_id)::int END FROM invoices WHERE status='issued' AND due_at < now()) AS past_due,
  (SELECT count(*)::int FROM customers c JOIN subscriptions s ON s.customer_id=c.id JOIN LATERAL (
     SELECT fulfillment_state,created_at FROM orders WHERE subscription_id=s.id AND NOT cancelled AND fulfillment_state<>'applied'
     ORDER BY created_at DESC,id DESC LIMIT 1) o ON true
   WHERE o.fulfillment_state IN ('failed','needs_intervention')
     OR (o.fulfillment_state IN ('queued','applying') AND o.created_at < now() - make_interval(hours => $1::int))) AS stalled,
  (SELECT count(*)::int FROM customers c LEFT JOIN subscriptions s ON s.customer_id=c.id WHERE c.commercial_setup_required OR s.id IS NULL) AS setup_required,
  (SELECT count(*)::int FROM (SELECT s.*, ${renewalSkipped} AS renewal_skipped FROM subscriptions s) s WHERE ${renewalDue}) AS renewals`

/** GET /v1/commercial/attention (vendor.read): a bounded, prioritized list of what needs the vendor today. Overdue invoices are billing detail: only `includeBilling` callers get them. */
export async function attention(pool: Pool, includeBilling: boolean) {
  const params = [STALLED_HOURS, RENEWAL_WINDOW_DAYS, includeBilling]
  const [list, counts] = await Promise.all([
    pool.query(`${subjectsSql}
      SELECT (SELECT count(*)::int FROM subjects) AS total,
        COALESCE((SELECT jsonb_agg(to_jsonb(p)-'rank'-'sort_at' ORDER BY p.rank,p.sort_at,p.customer_id,p.tenant_id)
          FROM (SELECT * FROM subjects ORDER BY rank,sort_at,customer_id,tenant_id LIMIT ${ATTENTION_LIMIT}) p),'[]'::jsonb) AS items`, params),
    pool.query(countsSql, params),
  ])
  return attentionSchema.parse({ items: list.rows[0].items, total: list.rows[0].total, counts: counts.rows[0] })
}
