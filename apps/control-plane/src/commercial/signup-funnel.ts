import type { Pool } from 'pg'
import type { Analytics } from '@liwan/commercial-contracts'
import { notOnlyAiTopupSql, periodBounds, type Period } from './analytics-model.js'
import { creditedMinorSql } from './refund-credit.js'

/** Cohort by signup date and the apps selected at enrollment. Money counts after confirmation and net of full credits. */
export async function signupFunnel(db: Pick<Pool, 'query'>, period: Period, now: Date): Promise<Analytics['signup_funnel']> {
  const { start, end } = periodBounds(period)
  const { rows } = await db.query(`WITH cohorts AS (
    SELECT s.id AS subscription_id, t.customer_id,
      CASE WHEN (r.snapshot#>>'{entitlement,features,crm.enabled}')::boolean THEN
        CASE WHEN (r.snapshot#>>'{entitlement,features,inbox.enabled}')::boolean THEN 'both' ELSE 'crm' END
        WHEN (r.snapshot#>>'{entitlement,features,inbox.enabled}')::boolean THEN 'inbox'
      END AS selection
    FROM public_signup_trials t
    JOIN subscriptions s ON s.customer_id=t.customer_id
    JOIN orders o ON o.subscription_id=s.id AND o.kind='new' AND o.payment_state='not_required'
    JOIN subscription_revisions r ON r.id=o.target_revision_id
    WHERE t.requires_first_login AND o.created_at >= $1 AND o.created_at < $2 AND o.created_at <= $3
  ), milestones AS (
    SELECT c.selection, started.deadline, paid.paid_at, renewal.due, renewal.renewed_at
    FROM cohorts c
    LEFT JOIN LATERAL (
      SELECT (a.metadata->>'trial_ends_at')::timestamptz AS deadline
      FROM audit_events a WHERE a.action='trial.started' AND a.subject=c.customer_id::text
        AND a.created_at <= $3 AND a.metadata ? 'trial_ends_at' ORDER BY a.created_at LIMIT 1
    ) started ON true
    LEFT JOIN LATERAL (
      SELECT i.paid_at,i.period_end FROM invoices i WHERE i.subscription_id=c.subscription_id
        AND i.status='paid' AND i.paid_at <= $3 AND i.total_minor > ${creditedMinorSql('i.id')} AND ${notOnlyAiTopupSql('i.id')}
      ORDER BY i.paid_at,i.id LIMIT 1
    ) paid ON true
    LEFT JOIN LATERAL (
      SELECT i.due_at + make_interval(days => p.grace_days) AS due,
        CASE WHEN i.status='paid' AND i.total_minor > ${creditedMinorSql('i.id')} THEN i.paid_at END AS renewed_at
      FROM renewals r JOIN invoices i ON i.id=r.invoice_id
      JOIN orders o ON o.id=r.order_id JOIN subscription_revisions v ON v.id=o.target_revision_id
      JOIN plan_revisions p ON p.id=(v.snapshot->>'plan_revision_id')::uuid
      WHERE r.subscription_id=c.subscription_id AND r.kind='renewal' AND r.status<>'superseded'
        AND r.period_start >= paid.period_end AND i.issued_at <= $3 AND i.status<>'void' AND NOT o.cancelled
      ORDER BY r.period_start,i.issued_at,i.id LIMIT 1
    ) renewal ON true
    WHERE c.selection IS NOT NULL
  )
  SELECT options.selection,
    count(m.selection)::int AS registered,
    count(*) FILTER (WHERE m.deadline IS NOT NULL)::int AS started,
    count(*) FILTER (WHERE m.deadline + interval '7 days' <= $3)::int AS conversion_eligible,
    count(*) FILTER (WHERE m.deadline + interval '7 days' <= $3 AND m.paid_at <= m.deadline + interval '7 days')::int AS converted,
    count(*) FILTER (WHERE m.due <= $3)::int AS renewal_eligible,
    count(*) FILTER (WHERE m.due <= $3 AND m.renewed_at <= m.due)::int AS renewed
  FROM (VALUES ('crm'), ('inbox'), ('both')) options(selection)
  LEFT JOIN milestones m ON m.selection=options.selection
  GROUP BY options.selection ORDER BY options.selection`, [new Date(start), new Date(end), now])
  return rows
}
