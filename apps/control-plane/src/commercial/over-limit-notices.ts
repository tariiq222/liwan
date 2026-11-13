import type { Pool } from 'pg'
import type { MailAdapter } from './mail-adapter.js'
import { completeOutbox, deferOutbox, failOutbox, leaseOutboxRow } from './outbox.js'
import type { FreeBaseLockCause } from '@liwan/commercial-contracts'

type LockNotice = { cause: FreeBaseLockCause }

/** The email subject and body for the cause that dropped the subscription to the free base. */
export function overLimitNotice(payload: LockNotice): { subject: string; text: string } {
  if (payload.cause === 'refund') return { subject: 'تحديث الاشتراك بعد استرداد الدفعة',
    text: 'سجّلنا استرداد دفعتك الأولى، فعاد اشتراكك إلى الباقة الأساسية المجانية. يمكنك شراء المزايا مجددًا من صفحة الاشتراك.\nYour first payment was refunded, so your subscription is back on the free base. You can buy the features again from Subscription.' }
  const subject = 'تحديث الاشتراك بعد انتهاء التجربة'
  if (payload.cause === 'first_invoice_unpaid') return { subject, text: 'انتهت مهلة دفع الفاتورة الأولى. يمكنك شراء المزايا مجددًا من صفحة الاشتراك.\nThe first invoice payment grace period ended. You can buy the features again from Subscription.' }
  return { subject, text: 'انتهت تجربتك. أصبحت التطبيقات غير المشتراة للقراءة والتصدير، ويُقيَّد الاستخدام الزائد. راجع الاشتراك لمعرفة ما بقي متاحًا.\nYour trial ended. Unpurchased apps now allow reading and export. Excess usage is restricted. See Subscription for what remains available.' }
}

/**
 * Sends the notice queued when the lock applies. One email per subscription (the outbox key), leased so two workers
 * send it once; a send that fails is deferred and retried, and a customer with no address fails the row loudly.
 */
export async function sendOverLimitNotices(pool: Pool, input: { mail: MailAdapter; signal?: AbortSignal }): Promise<number> {
  const rows = (await pool.query(`SELECT o.id,o.payload,c.admin_login FROM commercial_outbox o JOIN subscriptions s ON s.id::text=o.aggregate_id
    JOIN customers c ON c.id=s.customer_id WHERE o.kind='free_base.locked' AND o.status='pending' AND o.next_attempt_at <= now() ORDER BY o.created_at,o.id LIMIT 20`)).rows
  let sent = 0
  for (const row of rows) {
    if (input.signal?.aborted) return sent
    if (!await leaseOutboxRow(pool, row.id)) continue
    if (!row.admin_login) { await failOutbox(pool, row.id, 'no_recipient'); continue }
    try {
      const notice = overLimitNotice(row.payload)
      await input.mail.send({ to: row.admin_login, subject: notice.subject, text: notice.text, message_id: `over-limit-${row.id}@liwan` })
      await completeOutbox(pool, row.id)
      sent++
    } catch (error) { await deferOutbox(pool, row.id, error instanceof Error ? error.message.slice(0, 200) : 'over_limit_notice_failed') }
  }
  return sent
}
