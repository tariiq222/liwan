import type { Pool } from 'pg'
import { daysBetween, riyadhDate } from '@liwan/commercial-contracts'
import type { MailAdapter } from './mail-adapter.js'
import { completeOutbox, deferOutbox, enqueueOutbox, failOutbox, leaseOutboxRow } from './outbox.js'
import { daysText } from './billing-notices.js'
import { holdsFreeBaseLockSql } from './free-base.js'
import { CANCELLATION_NOTICE_KIND, type CancellationNoticePayload } from './cancellation.js'
import { CANCELLATION_REMINDER_DAYS } from './notice-timings.js'

/** The subject and body (Arabic, then English) of one cancellation notice. */
export function cancellationNotice(payload: CancellationNoticePayload, daysLeft: number): { subject: string; text: string } {
  const on = payload.effective_on
  const last = new Date(Date.parse(`${on}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
  const bodies: Record<CancellationNoticePayload['type'], { subject: string; ar: string; en: string }> = {
    cancelled: { subject: 'تأكيد إلغاء تجديد اشتراكك في LiwanOS',
      ar: `ألغينا تجديد اشتراكك. تبقى تطبيقاتك المدفوعة متاحة حتى ${last}، وفي ${on} تعود مساحة العمل إلى القاعدة المجانية: بياناتك محفوظة، والتطبيقات غير المشمولة فيها تصبح للقراءة والتصدير فقط. إن غيّرت رأيك فاستأنف الاشتراك من صفحة الاشتراك قبل ${on}.`,
      en: `Your subscription will not renew. Your paid applications stay available through ${last}; on ${on} your workspace returns to the free base: your data is kept, and apps the free base does not include become read-only and exportable. If you change your mind, resume the subscription from Subscription before ${on}.` },
    resumed: { subject: 'استأنفنا اشتراكك في LiwanOS',
      ar: `أُلغي طلب الإلغاء، وسيتجدد اشتراكك في ${on} كالمعتاد.`,
      en: `The cancellation was withdrawn. Your subscription renews on ${on} as usual.` },
    ending_soon: { subject: 'تنتهي فترة اشتراكك المدفوع في LiwanOS قريبًا',
      ar: `تبقى تطبيقاتك المدفوعة متاحة حتى ${last}، وفي ${on} (بعد ${daysText(daysLeft, 'ar')}) تعود مساحة العمل إلى القاعدة المجانية وتبقى بياناتك محفوظة، لأنك ألغيت التجديد. لإبقاء اشتراكك استأنفه من صفحة الاشتراك.`,
      en: `Your paid applications stay available through ${last}, and on ${on} (in ${daysText(daysLeft, 'en')}) your workspace returns to the free base and your data is kept, because you cancelled the renewal. To keep your subscription, resume it from Subscription.` },
  }
  const body = bodies[payload.type]
  return { subject: body.subject, text: `${body.ar}\n${body.en}` }
}

/** The renewal date the cancellation takes effect on, if the subscription is still cancelled for it and no lock has started. */
async function stillCancelledFor(pool: Pool, payload: CancellationNoticePayload): Promise<{ admin_login: string | null } | undefined> {
  return (await pool.query(`SELECT c.admin_login FROM subscriptions s JOIN customers c ON c.id=s.customer_id WHERE s.id=$1
    AND s.cancel_requested_at IS NOT NULL AND s.renewal_at::text=$2 AND NOT ${holdsFreeBaseLockSql('s')}`, [payload.subscription_id, payload.effective_on])).rows[0]
}

async function queueReminders(pool: Pool, today: string): Promise<void> {
  const ending = (await pool.query(`SELECT s.id,s.renewal_at::text AS renewal_on FROM subscriptions s
    WHERE s.cancel_requested_at IS NOT NULL AND NOT s.manual_suspension AND s.renewal_at <= $1::date + $2::int AND NOT ${holdsFreeBaseLockSql('s')}`,
  [today, CANCELLATION_REMINDER_DAYS])).rows
  for (const row of ending) {
    if (daysBetween(today, row.renewal_on) < 1) continue
    await enqueueOutbox(pool, { kind: CANCELLATION_NOTICE_KIND, aggregate_id: row.id, dedupe_key: `ending_soon:${row.id}:${row.renewal_on}`,
      payload: { type: 'ending_soon', subscription_id: row.id, effective_on: row.renewal_on } satisfies CancellationNoticePayload })
  }
}

/**
 * Queues the reminder for cancellations that end within three days, then sends every pending cancellation notice. Each row is
 * leased so two workers send it once and is checked against the live subscription just before sending: a "cancelled" or
 * "ending soon" notice for a cancellation that was withdrawn (or whose date moved) is closed, and so is a "resumed" notice for
 * a subscription cancelled again.
 */
export async function sendCancellationNotices(pool: Pool, input: { now: Date; mail: MailAdapter; signal?: AbortSignal }): Promise<number> {
  if (input.signal?.aborted) return 0
  const today = riyadhDate(input.now)
  await queueReminders(pool, today)
  const rows = (await pool.query(`SELECT id,payload FROM commercial_outbox WHERE kind=$1 AND status='pending' AND next_attempt_at <= now()
    ORDER BY created_at,id LIMIT 50`, [CANCELLATION_NOTICE_KIND])).rows as { id: string; payload: CancellationNoticePayload }[]
  let sent = 0
  for (const row of rows) {
    if (input.signal?.aborted) return sent
    if (!await leaseOutboxRow(pool, row.id)) continue
    try {
      const { payload } = row
      const recipient = payload.type === 'resumed'
        ? (await pool.query(`SELECT c.admin_login FROM subscriptions s JOIN customers c ON c.id=s.customer_id WHERE s.id=$1 AND s.cancel_requested_at IS NULL`, [payload.subscription_id])).rows[0]
        : await stillCancelledFor(pool, payload)
      if (!recipient) { await completeOutbox(pool, row.id); continue }
      if (!recipient.admin_login) { await failOutbox(pool, row.id, 'no_recipient'); continue }
      const notice = cancellationNotice(payload, daysBetween(today, payload.effective_on))
      await input.mail.send({ to: recipient.admin_login, subject: notice.subject, text: notice.text, message_id: `cancellation-${row.id}@liwan` })
      await completeOutbox(pool, row.id)
      sent++
    } catch (error) { await deferOutbox(pool, row.id, error instanceof Error ? error.message.slice(0, 200) : 'cancellation_notice_failed') }
  }
  return sent
}
