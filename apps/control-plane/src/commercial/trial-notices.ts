import type { Pool } from 'pg'
import { daysBetween, riyadhDate } from '@webvue/commercial-contracts'
import type { MailAdapter } from './mail-adapter.js'
import { completeOutbox, enqueueOutbox, failOutbox } from './outbox.js'

/**
 * One email per notice threshold and subscription. The in-app banner is always available from
 * `trial_ends_at`; email is an additional channel and its absence never changes the state.
 */
export async function sendTrialNotices(pool: Pool, input: { now: Date; mail: MailAdapter }): Promise<number> {
  const rows = (await pool.query(`SELECT s.id,s.trial_ends_at,s.customer_id,p.trial_days,sr.snapshot,c.admin_login
    FROM subscriptions s JOIN subscription_revisions sr ON sr.id=s.applied_revision_id
    JOIN plan_revisions p ON p.id=(sr.snapshot->>'plan_revision_id')::uuid
    JOIN customers c ON c.id=s.customer_id
    WHERE s.state='trialing' AND s.trial_ends_at IS NOT NULL ORDER BY s.id`)).rows
  let sent = 0
  for (const row of rows) {
    const daysLeft = daysBetween(riyadhDate(input.now), riyadhDate(new Date(row.trial_ends_at)))
    // Day 11 and day 13 of a 14-day trial: three and one days remaining, never past the trial end.
    const thresholds = [3, 1].filter(days => days < Number(row.trial_days))
    if (!thresholds.includes(daysLeft)) continue
    const quote = (await pool.query('SELECT payload FROM commercial_quotes WHERE id=$1', [row.snapshot.quote_id])).rows[0]?.payload
    const inserted = await enqueueOutbox(pool, {
      kind: 'trial.notice', aggregate_id: row.id, dedupe_key: `trial-notice:${row.id}:${daysLeft}`,
      payload: { subscription_id: row.id, days_left: daysLeft, trial_ends_at: riyadhDate(new Date(row.trial_ends_at)), amount: quote?.next_renewal ?? null },
    })
    if (!inserted) continue
    sent++
    if (!row.admin_login) { await completeOutbox(pool, (await pool.query("SELECT id FROM commercial_outbox WHERE kind='trial.notice' AND aggregate_id=$1 AND dedupe_key=$2", [row.id, `trial-notice:${row.id}:${daysLeft}`])).rows[0].id); continue }
    try {
      const amount = quote?.next_renewal
      const text = `تنتهي تجربتك في ${riyadhDate(new Date(row.trial_ends_at))} (${daysLeft} يومًا متبقيًا).`
        + (amount ? ` قيمة أول فاتورة بعد التجربة: ${(amount.minor / 10 ** amount.exponent).toFixed(amount.exponent)} ${amount.currency}.` : '')
      await input.mail.send({ to: row.admin_login, subject: 'تجربتك في WebVue على وشك الانتهاء', text, message_id: `trial-${row.id}-${daysLeft}@webvue` })
      const outbox = (await pool.query("SELECT id FROM commercial_outbox WHERE kind='trial.notice' AND aggregate_id=$1 AND dedupe_key=$2", [row.id, `trial-notice:${row.id}:${daysLeft}`])).rows[0]
      await completeOutbox(pool, outbox.id)
    } catch (error) {
      const outbox = (await pool.query("SELECT id FROM commercial_outbox WHERE kind='trial.notice' AND aggregate_id=$1 AND dedupe_key=$2", [row.id, `trial-notice:${row.id}:${daysLeft}`])).rows[0]
      await failOutbox(pool, outbox.id, error instanceof Error ? error.message.slice(0, 200) : 'trial_notice_failed')
    }
  }
  return sent
}
