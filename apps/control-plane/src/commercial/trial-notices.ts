import type { Pool } from 'pg'
import { daysBetween, riyadhDate } from '@liwan/commercial-contracts'
import type { MailAdapter } from './mail-adapter.js'
import { completeOutbox, enqueueOutbox, failOutbox, leaseOutboxRow } from './outbox.js'
import { freeBaseOf } from './free-base.js'
import { TRIAL_NOTICE_DAYS } from './notice-timings.js'

/**
 * One email per notice threshold and subscription. The in-app banner is always available from
 * `trial_ends_at`; email is an additional channel and its absence never changes the state.
 * After `signal` (worker shutdown) no further notice is queued or sent; the next run catches up.
 * One subscription that fails is logged and skipped, never allowed to stop everyone else's notices, and a row is sent by
 * the one worker that leases it.
 */
export async function sendTrialNotices(pool: Pool, input: { now: Date; mail: MailAdapter; signal?: AbortSignal }): Promise<number> {
  const rows = (await pool.query(`SELECT s.*,p.trial_days,sr.snapshot,c.admin_login
    FROM subscriptions s JOIN subscription_revisions sr ON sr.id=s.applied_revision_id
    JOIN plan_revisions p ON p.id=(sr.snapshot->>'plan_revision_id')::uuid
    JOIN customers c ON c.id=s.customer_id
    WHERE s.state='trialing' AND s.trial_ends_at IS NOT NULL ORDER BY s.id`)).rows
  let sent = 0
  for (const row of rows) {
    if (input.signal?.aborted) return sent
    try { sent += await noticesOf(pool, row, input) }
    catch (error) { console.error(`[trial-notices] subscription ${row.id} skipped: ${error instanceof Error ? error.message.slice(0, 200) : 'error'}`) }
  }
  return sent
}

async function noticesOf(pool: Pool, row: Record<string, any>, input: { now: Date; mail: MailAdapter; signal?: AbortSignal }): Promise<number> {
  const daysLeft = daysBetween(riyadhDate(input.now), riyadhDate(new Date(row.trial_ends_at)))
  const trialEnds = riyadhDate(new Date(row.trial_ends_at))
  let sent = 0
  // Day 11 and day 13 of a 14-day trial: <= so a missed scheduler day catches up; the threshold,
  // not the current day, is the dedupe key, so a late run still sends each notice once.
  for (const threshold of TRIAL_NOTICE_DAYS.filter(days => days < Number(row.trial_days))) {
    if (daysLeft > threshold) continue
    if (input.signal?.aborted) return sent
    const dedupe = `trial-notice:${row.id}:${threshold}`
    const inserted = await enqueueOutbox(pool, { kind: 'trial.notice', aggregate_id: row.id, dedupe_key: dedupe,
      payload: { subscription_id: row.id, days_left: daysLeft, trial_ends_at: trialEnds } })
    const existing = (await pool.query("SELECT id,status FROM commercial_outbox WHERE kind='trial.notice' AND aggregate_id=$1 AND dedupe_key=$2", [row.id, dedupe])).rows[0]
    // A failed send, or one interrupted after the row was queued but before delivery, is retried on the next run;
    // only a completed row is left alone.
    if (!inserted && (!existing || !['failed', 'pending'].includes(existing.status))) continue
    if (!inserted && existing.status === 'failed') await pool.query("UPDATE commercial_outbox SET status='pending',processed_at=NULL,payload=payload-'error',next_attempt_at=now() WHERE id=$1", [existing.id])
    if (!await leaseOutboxRow(pool, existing.id)) continue
    sent++
    if (!row.admin_login) { await completeOutbox(pool, existing.id); continue }
    try {
      // On a plan with a free base nothing is invoiced when the trial ends: the notice says what locks instead of an amount.
      const onFreeBase = await freeBaseOf(pool, { subscription: row, snapshot: row.snapshot, start: trialEnds })
      const quote = (await pool.query('SELECT payload FROM commercial_quotes WHERE id=$1', [row.snapshot.quote_id])).rows[0]?.payload
      const amount = onFreeBase ? null : quote?.next_renewal
      const ar = `تنتهي تجربتك في ${trialEnds} (${daysLeft} يومًا متبقيًا).`
        + (onFreeBase ? ' بعدها تنتقل شركتك إلى القاعدة المجانية، وتُقفل التطبيقات المدفوعة فورًا للقراءة والتصدير فقط حتى تشترك فيها. إن كان استخدامك يتجاوز حدود القاعدة (مستخدمون أو تخزين أو فروع) تبقى بياناتك ومستخدموك كما هي دون حذف أو أرشفة، ويُمنع فقط إضافة المزيد، وسنخبرك بما يتجاوز. أي طلب ترقية لم تدفعه حتى ذلك الوقت يُلغى، ويمكنك طلب ترقية جديدة في أي وقت.' : '')
        + (amount ? ` قيمة أول فاتورة بعد التجربة: ${(amount.minor / 10 ** amount.exponent).toFixed(amount.exponent)} ${amount.currency}.` : '')
      const en = `Your trial ends on ${trialEnds} (${daysLeft} days left).`
        + (onFreeBase ? ' After that your company moves to the free base and the paid applications are locked immediately to read and export only until you subscribe to them. If your usage is above the free base limits (users, storage or branches), your users and data stay as they are and nothing is deleted or archived; only adding more is prevented, and we will tell you what exceeds. Any upgrade order you have not paid by then is cancelled, and you can request a new upgrade at any time.' : '')
        + (amount ? ` The first invoice after the trial is ${(amount.minor / 10 ** amount.exponent).toFixed(amount.exponent)} ${amount.currency}.` : '')
      const text = `${ar}\n${en}`
      await input.mail.send({ to: row.admin_login, subject: 'تجربتك في LiwanOS على وشك الانتهاء', text, message_id: `trial-${row.id}-${dedupe}@liwan` })
      await completeOutbox(pool, existing.id)
    } catch (error) {
      await failOutbox(pool, existing.id, error instanceof Error ? error.message.slice(0, 200) : 'trial_notice_failed')
    }
  }
  return sent
}
