import type { Pool } from 'pg'
import { daysBetween, riyadhDate } from '@liwan/commercial-contracts'
import type { MailAdapter } from './mail-adapter.js'
import { completeOutbox, enqueueOutbox, failOutbox, leaseOutboxRow } from './outbox.js'
import { RENEWAL_NOTICE_DAYS } from './notice-timings.js'
import { owesAtRenewal } from './free-base.js'

/**
 * The outbox key of the notice for one subscription, renewal date and amount. The amount is part of the key: a notice
 * covers a charge of exactly that amount, so an upgrade between the notice and the renewal makes a new notice due and the
 * old one never covers the new amount.
 */
export const renewalNoticeKey = (subscriptionId: string, renewalDate: string, amount: { minor: number; currency: string }) =>
  `renewal-notice:${subscriptionId}:${renewalDate}:${amount.currency}${amount.minor}`

/**
 * Whether a stored method may be charged on `renewalDate`: the notice for exactly that date was really sent (`sentAt` is
 * set only by a delivered mail), at least `RENEWAL_NOTICE_DAYS` calendar days before it, and after the customer's current
 * consent, so a method enabled inside the notice window, or re-enabled after the notice, is paid by the customer once.
 */
export function renewalNoticeCovers(sentAt: string | null, consentAt: Date | string, renewalDate: string): boolean {
  if (!sentAt) return false
  const sent = new Date(sentAt), consent = new Date(consentAt)
  if (Number.isNaN(sent.getTime()) || sent.getTime() < consent.getTime()) return false
  return daysBetween(riyadhDate(sent), renewalDate) >= RENEWAL_NOTICE_DAYS
}

/**
 * One email per subscription and renewal date, sent once the renewal is within `RENEWAL_NOTICE_DAYS`, to a customer
 * whose stored payment method is about to be charged. The renewal date is part of the dedupe key, so the next period
 * notifies again and a late run still sends each notice once. A subscription that owes nothing at renewal is never
 * charged, so it is never told it will be; one whose renewal already exists was past the notice. The mail never
 * carries the payment method. After `signal` (worker shutdown) nothing further is queued or sent.
 */
export async function sendRenewalNotices(pool: Pool, input: { now: Date; mail: MailAdapter; signal?: AbortSignal }): Promise<number> {
  const today = riyadhDate(input.now)
  const rows = (await pool.query(`SELECT s.id,s.renewal_at,sr.snapshot,c.admin_login FROM subscriptions s
    JOIN subscription_revisions sr ON sr.id=s.applied_revision_id JOIN customers c ON c.id=s.customer_id
    WHERE s.state='active' AND s.auto_renew_enabled AND s.auto_renew_consent_at IS NOT NULL AND s.provider_token_ref IS NOT NULL
      AND s.renewal_at IS NOT NULL AND s.renewal_at <= $1::date + $2::int AND s.renewal_at >= $1::date
      AND NOT EXISTS (SELECT 1 FROM renewals r WHERE r.subscription_id=s.id AND r.period_start=s.renewal_at AND r.kind='renewal')
    ORDER BY s.id`, [today, RENEWAL_NOTICE_DAYS])).rows
  let sent = 0
  for (const row of rows) {
    if (input.signal?.aborted) return sent
    if (!owesAtRenewal(row.snapshot.pricing)) continue
    const renewalAt = riyadhDate(row.renewal_at instanceof Date ? row.renewal_at : new Date(`${row.renewal_at}T00:00:00+03:00`))
    // The notice states the amount that will be charged; without a known amount there is nothing true to tell.
    const quote = (await pool.query('SELECT payload FROM commercial_quotes WHERE id=$1', [row.snapshot.quote_id])).rows[0]?.payload
    const amount = quote?.next_renewal as { minor: number; currency: string; exponent: number } | undefined
    if (!amount) continue
    const dedupe = renewalNoticeKey(row.id, renewalAt, amount)
    const inserted = await enqueueOutbox(pool, { kind: 'renewal.notice', aggregate_id: row.id, dedupe_key: dedupe,
      payload: { subscription_id: row.id, renewal_at: renewalAt } })
    const outbox = (await pool.query("SELECT id,status FROM commercial_outbox WHERE kind='renewal.notice' AND aggregate_id=$1 AND dedupe_key=$2", [row.id, dedupe])).rows[0]
    // Only a row that has not been delivered is worked on: a done row is the notice already sent.
    if (!inserted && (!outbox || !['failed', 'pending'].includes(outbox.status))) continue
    if (!inserted && outbox.status === 'failed') await pool.query("UPDATE commercial_outbox SET status='pending',processed_at=NULL,payload=payload-'error',next_attempt_at=now() WHERE id=$1", [outbox.id])
    if (!await leaseOutboxRow(pool, outbox.id)) continue
    // Nobody to tell is not a notice: the row fails, and the method is not charged for this date.
    if (!row.admin_login) { await failOutbox(pool, outbox.id, 'no_recipient'); continue }
    sent++
    const daysLeft = daysBetween(today, renewalAt)
    try {
      const figure = `${(amount.minor / 10 ** amount.exponent).toFixed(amount.exponent)} ${amount.currency}`
      const text = `سيُجدَّد اشتراكك تلقائيًا في ${renewalAt} (بعد ${daysLeft} يومًا)، وسيُخصم ${figure} من وسيلة الدفع المحفوظة. يمكنك إيقاف التجديد التلقائي قبل هذا التاريخ من صفحة الاشتراك؛ الإيقاف بعد بدء الخصم يسري من الدورة التالية.\n`
        + `Your subscription renews automatically on ${renewalAt} (in ${daysLeft} days) and ${figure} will be charged to the saved payment method. You can turn auto-renew off on the subscription page before that date; turning it off after the charge has started applies from the next period.`
      await input.mail.send({ to: row.admin_login, subject: 'تجديد اشتراكك في LiwanOS قريبًا', text, message_id: `renewal-${row.id}-${dedupe}@liwan` })
      // The delivery time is what lets the renewal charge the stored method.
      await pool.query("UPDATE commercial_outbox SET payload=payload||jsonb_build_object('sent_at',$2::text) WHERE id=$1", [outbox.id, input.now.toISOString()])
      await completeOutbox(pool, outbox.id)
    } catch (error) {
      await failOutbox(pool, outbox.id, error instanceof Error ? error.message.slice(0, 200) : 'renewal_notice_failed')
    }
  }
  return sent
}
