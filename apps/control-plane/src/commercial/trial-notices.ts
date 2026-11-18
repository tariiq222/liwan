import type { Pool } from 'pg'
import { daysBetween, riyadhDate } from '@liwan/commercial-contracts'
import type { MailAdapter } from './mail-adapter.js'
import { completeOutbox, enqueueOutbox, failOutbox, leaseOutboxRow, releaseOutbox } from './outbox.js'
import { trialEndPreview } from './trial-preview.js'
import { paidTrialLines } from './trial-ledger.js'
import { TRIAL_NOTICE_DAYS } from './notice-timings.js'
import { cadenceText, countText, daysText, formatMoney, storageText } from './billing-notices.js'
import { workspaceLines, workspaceOrigin, type ReturnOrigin } from './return-origin.js'
import { logText } from '../log-text.js'

/**
 * One email per notice threshold and subscription. The in-app banner is always available from
 * `trial_ends_at`; email is an additional channel and its absence never changes the state.
 * After `signal` (worker shutdown) no further notice is queued or sent; the next run catches up.
 * One subscription that fails is logged and skipped, never allowed to stop everyone else's notices, and a row is sent by
 * the one worker that leases it.
 */
export async function sendTrialNotices(pool: Pool, input: { now: Date; mail: MailAdapter; returnOrigin?: ReturnOrigin; signal?: AbortSignal }): Promise<number> {
  if (input.signal?.aborted) return 0
  const rows = (await pool.query(`SELECT s.*,p.trial_days,sr.snapshot,c.admin_login
    FROM subscriptions s JOIN subscription_revisions sr ON sr.id=s.applied_revision_id
    JOIN plan_revisions p ON p.id=(sr.snapshot->>'plan_revision_id')::uuid
    JOIN customers c ON c.id=s.customer_id
    WHERE s.state='trialing' AND s.trial_ends_at IS NOT NULL ORDER BY s.id`)).rows
  let sent = 0
  for (const row of rows) {
    if (input.signal?.aborted) return sent
    try { sent += await noticesOf(pool, row, input) }
    catch (error) { console.error('[trial-notices] subscription %s skipped: %s', row.id, logText(error instanceof Error ? error : 'error')) }
  }
  return sent
}

async function noticesOf(pool: Pool, row: Record<string, any>, input: { now: Date; mail: MailAdapter; returnOrigin?: ReturnOrigin; signal?: AbortSignal }): Promise<number> {
  const daysLeft = daysBetween(riyadhDate(input.now), riyadhDate(new Date(row.trial_ends_at)))
  const trialEnds = riyadhDate(new Date(row.trial_ends_at))
  let sent = 0
  // The thresholds of TRIAL_NOTICE_DAYS (days before the end): <= so a missed scheduler day catches up; the threshold,
  // not the current day, is the dedupe key, so a late run still sends each notice once.
  for (const threshold of TRIAL_NOTICE_DAYS.filter(days => days < Number(row.trial_days))) {
    if (daysLeft > threshold) continue
    if (input.signal?.aborted) return sent
    const dedupe = `trial-notice:${row.id}:${threshold}`
    const inserted = await enqueueOutbox(pool, { kind: 'trial.notice', aggregate_id: row.id, dedupe_key: dedupe,
      payload: { subscription_id: row.id, days_left: daysLeft, trial_ends_at: trialEnds } })
    if (input.signal?.aborted) return sent
    const existing = (await pool.query("SELECT id,status FROM commercial_outbox WHERE kind='trial.notice' AND aggregate_id=$1 AND dedupe_key=$2", [row.id, dedupe])).rows[0]
    if (input.signal?.aborted) return sent
    // A failed send, or one interrupted after the row was queued but before delivery, is retried on the next run;
    // only a completed row is left alone.
    if (!inserted && (!existing || !['failed', 'pending'].includes(existing.status))) continue
    if (!inserted && existing.status === 'failed') await pool.query("UPDATE commercial_outbox SET status='pending',processed_at=NULL,payload=payload-'error',next_attempt_at=now() WHERE id=$1 AND status='failed'", [existing.id])
    if (input.signal?.aborted) return sent
    const leaseUntil = await leaseOutboxRow(pool, existing.id)
    if (!leaseUntil) continue
    if (input.signal?.aborted) {
      await releaseOutbox(pool, existing.id, leaseUntil)
      return sent
    }
    sent++
    if (!row.admin_login) { await completeOutbox(pool, existing.id); continue }
    let deliveryStarted = false
    try {
      const preview = await trialEndPreview(pool, row.customer_id, input.now)
      if (input.signal?.aborted) {
        await releaseOutbox(pool, existing.id, leaseUntil)
        return sent - 1
      }
      const { limits, price_after_trial: price } = preview
      const cadence = row.snapshot.cadence
      // The first charge at checkout skips what the trial already paid; the price below is the recurring one.
      const partlyPaid = price !== null && (await paidTrialLines(pool, row.id, input.now)).length > 0
      const after = (language: 'ar' | 'en') => price
        ? (language === 'ar'
          ? `لتستمر على تطبيقاتك بعد التجربة: ${formatMoney(price, 'ar')} ${cadenceText(cadence, 'ar')}. اشترك من صفحة الاشتراك بزر «راجع الاشتراك».${partlyPaid ? ' ستكون الفاتورة الأولى أقل، لأن جزءًا من الفترة مدفوع بالفعل.' : ''}`
          : `To keep your apps after the trial: ${formatMoney(price, 'en')} ${cadenceText(cadence, 'en')}. Subscribe from the Subscription page with the button "Review subscription".${partlyPaid ? ' Your first invoice will be lower because part of the period is already paid.' : ''}`)
        : (language === 'ar' ? 'تستمر خطتك مجانًا بعد التجربة.' : 'Your plan continues free after the trial.')
      const ar = `تنتهي تجربتك في ${trialEnds} (باقي ${daysText(daysLeft, 'ar')}). تبقى المزايا المضمنة والمشتراة. تُقفل التطبيقات الأخرى للقراءة والتصدير فقط. الحدود بعد التجربة: ${countText(limits.users, 'user', 'ar')}، ${storageText(limits.storage_mb, 'ar')} للتخزين، ${countText(limits.extra_branches, 'branch', 'ar')}. ${after('ar')} راجع صفحة الاشتراك لمعرفة الاستخدام الزائد، وصدّر الملفات التي تحتاجها قبل انتهاء التجربة.`
      const en = `Your trial ends on ${trialEnds} (${daysText(daysLeft, 'en')} left). Included and purchased features remain. Other trial apps become read and export only. Limits after the trial: ${countText(limits.users, 'user', 'en')}, ${storageText(limits.storage_mb, 'en')} storage, ${countText(limits.extra_branches, 'branch', 'en')}. ${after('en')} Check Subscription for excess usage and export the files you need before the trial ends.`
      const workspace = workspaceLines(await workspaceOrigin(input.returnOrigin, row.customer_id))
      const text = `${ar}${workspace.ar}\n${en}${workspace.en}`
      deliveryStarted = true
      await input.mail.send({ to: row.admin_login, subject: 'تجربتك في LiwanOS على وشك الانتهاء', text, message_id: `trial-${row.id}-${dedupe}@liwan` })
      await completeOutbox(pool, existing.id)
    } catch (error) {
      if (!deliveryStarted && input.signal?.aborted) {
        await releaseOutbox(pool, existing.id, leaseUntil)
        return sent - 1
      }
      await failOutbox(pool, existing.id, error instanceof Error ? error.message.slice(0, 200) : 'trial_notice_failed')
    }
  }
  return sent
}
