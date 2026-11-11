import type { Pool } from 'pg'
import { ATTENTION_LIMIT, attentionSchema } from '@liwan/commercial-contracts'
import { creditedMinorSql } from './refund-credit.js'
import { holdsTrialAfterLapseSql, owesAtRenewalSql } from './free-base.js'

export const RENEWAL_WINDOW_DAYS = 7
export const STALLED_HOURS = 24
/** Two normal lapse scans without a state change. */
const TRIAL_END_OVERDUE_MINUTES = 10
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
), lock_blocked AS (
  SELECT c.id AS customer_id, c.name, c.tenant_id, l.lapsed_at, l.reason FROM trial_lapses l
  JOIN subscriptions s ON s.id=l.subscription_id JOIN customers c ON c.id=s.customer_id
  WHERE l.state IN ('pending','ordered') AND l.reason IS NOT NULL
), renewal_failures AS (
  -- A renewal that failed for this subscription alone (the others kept renewing): the machine reason of the last failure.
  SELECT c.id AS customer_id, c.name, c.tenant_id, s.renewal_failed_at, s.renewal_failure FROM subscriptions s JOIN customers c ON c.id=s.customer_id
  WHERE s.renewal_failure IS NOT NULL
), trial_overdue AS (
  -- A trial whose end date is older than one scheduler interval and whose end has not run: new orders are closed
  -- (trial_ending) until it does, and the paid applications are still writable, so it must not wait unseen.
  SELECT c.id AS customer_id, c.name, c.tenant_id, s.trial_ends_at FROM subscriptions s JOIN customers c ON c.id=s.customer_id
  WHERE s.state='trialing' AND s.applied_revision_id IS NOT NULL AND s.trial_ends_at < now() - make_interval(mins => ${TRIAL_END_OVERDUE_MINUTES})
), suspension_undelivered AS (
  SELECT c.id AS customer_id,c.name,c.tenant_id,s.suspension_pending_since,s.tenant_status_failures
  FROM subscriptions s JOIN customers c ON c.id=s.customer_id
  WHERE (s.state='suspended' OR s.manual_suspension) AND s.tenant_status_pushed IS DISTINCT FROM 'suspended'
    AND s.suspension_pending_since IS NOT NULL
    AND (s.tenant_status_failures >= 5 OR s.suspension_pending_since <= now() - interval '2 hours')
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
), invitation_failures AS (
  -- The latest invitation per tenant and admin login ended as failed (delivery gave up after its retries): nobody holds a
  -- usable link. A later pending or delivered re-issue is the latest row, so it clears the item.
  SELECT customer_id, tenant_id, name, created_at FROM (
    SELECT DISTINCT ON (i.tenant_id, i.admin_login) i.customer_id, i.tenant_id, c.name, i.created_at, i.delivery_status, i.consumed_at, i.revoked_at
    FROM admin_invitations i JOIN customers c ON c.id=i.customer_id
    ORDER BY i.tenant_id, i.admin_login, i.created_at DESC, i.id
  ) latest_invitation
  WHERE delivery_status='failed' AND consumed_at IS NULL AND revoked_at IS NULL
  UNION ALL
  -- The first invitation could not even be issued (its outbox row failed for good), so no invitation row exists for the
  -- tenant. Any invitation issued afterwards (a vendor re-issue) clears the item.
  -- One item per customer, dated by its latest failure, however many issue rows failed.
  SELECT * FROM (
    SELECT DISTINCT ON (c.id) c.id, c.tenant_id, c.name, ob.processed_at FROM commercial_outbox ob
    JOIN subscriptions s ON s.id::text=ob.payload->>'subscription_id' JOIN customers c ON c.id=s.customer_id
    WHERE ob.kind='invitation.issue' AND ob.status='failed' AND c.tenant_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM admin_invitations i WHERE i.tenant_id=c.tenant_id AND i.admin_login=c.admin_login)
    ORDER BY c.id, ob.processed_at DESC
  ) latest_issue_failure
), subjects AS (
  SELECT 1 AS rank,'past_due' AS kind, customer_id, tenant_id, NULL::uuid AS operation_id, invoice_id, name, ${iso('due_at')} AS since, NULL::text AS detail, due_at AS sort_at FROM overdue WHERE $3::boolean
  UNION ALL SELECT 2,'refund_rejected', customer_id, tenant_id, NULL, invoice_id, name, ${iso('processed_at')}, reason, processed_at FROM rejected_refunds WHERE $3::boolean
  UNION ALL SELECT 2,'suspension_undelivered', customer_id, tenant_id, NULL, NULL, name,
    ${iso('suspension_pending_since')}, tenant_status_failures::text, suspension_pending_since FROM suspension_undelivered
  UNION ALL SELECT 3,'billing_blocked', customer_id, tenant_id, NULL, NULL, name, ${iso('billing_blocked_at')}, NULL, billing_blocked_at FROM blocked
  UNION ALL SELECT 3,'free_base_blocked', customer_id, tenant_id, NULL, NULL, name, ${iso('lapsed_at')}, reason, lapsed_at FROM lock_blocked
  UNION ALL SELECT 3,'trial_end_overdue', customer_id, tenant_id, NULL, NULL, name, ${iso('trial_ends_at')}, NULL, trial_ends_at FROM trial_overdue
  UNION ALL SELECT 3,'renewal_failed', customer_id, tenant_id, NULL, NULL, name, ${iso('renewal_failed_at')}, renewal_failure, renewal_failed_at FROM renewal_failures
  UNION ALL SELECT 4,'stalled_activation', customer_id, tenant_id, NULL, NULL, name, ${iso('order_created_at')}, fulfillment_state, order_created_at FROM stalled
  UNION ALL SELECT 4,'invitation_failed', customer_id, tenant_id, NULL, NULL, name, ${iso('created_at')}, NULL, created_at FROM invitation_failures
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
