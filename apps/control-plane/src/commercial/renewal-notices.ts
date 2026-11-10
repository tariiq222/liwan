import type { Pool } from 'pg'
import { daysBetween, riyadhDate } from '@liwan/commercial-contracts'
import type { MailAdapter } from './mail-adapter.js'
import { completeOutbox, enqueueOutbox, failOutbox } from './outbox.js'
import { RENEWAL_NOTICE_DAYS } from './notice-timings.js'
import { owesAtRenewal } from './free-base.js'

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
    const dedupe = `renewal-notice:${row.id}:${renewalAt}`
    const inserted = await enqueueOutbox(pool, { kind: 'renewal.notice', aggregate_id: row.id, dedupe_key: dedupe,
      payload: { subscription_id: row.id, renewal_at: renewalAt } })
    const outbox = (await pool.query("SELECT id,status FROM commercial_outbox WHERE kind='renewal.notice' AND aggregate_id=$1 AND dedupe_key=$2", [row.id, dedupe])).rows[0]
    // Only a row that has not been delivered is worked on: a done row is the notice already sent.
    if (!inserted) {
      if (!outbox || !['failed', 'pending'].includes(outbox.status)) continue
      if (outbox.status === 'failed') await pool.query("UPDATE commercial_outbox SET status='pending',processed_at=NULL,payload=payload-'error' WHERE id=$1", [outbox.id])
    }
    sent++
    if (!row.admin_login) { await completeOutbox(pool, outbox.id); continue }
    const quote = (await pool.query('SELECT payload FROM commercial_quotes WHERE id=$1', [row.snapshot.quote_id])).rows[0]?.payload
    const amount = quote?.next_renewal
    const daysLeft = daysBetween(today, renewalAt)
    try {
      const text = `سيُجدَّد اشتراكك تلقائيًا في ${renewalAt} (بعد ${daysLeft} يومًا)`
        + (amount ? ` وسيُخصم ${(amount.minor / 10 ** amount.exponent).toFixed(amount.exponent)} ${amount.currency} من وسيلة الدفع المحفوظة.` : ' من وسيلة الدفع المحفوظة.')
        + ' يمكنك إيقاف التجديد التلقائي في أي وقت من صفحة الاشتراك قبل هذا التاريخ.'
      await input.mail.send({ to: row.admin_login, subject: 'تجديد اشتراكك في LiwanOS قريبًا', text, message_id: `renewal-${row.id}-${dedupe}@liwan` })
      await completeOutbox(pool, outbox.id)
    } catch (error) {
      await failOutbox(pool, outbox.id, error instanceof Error ? error.message.slice(0, 200) : 'renewal_notice_failed')
    }
  }
  return sent
}
