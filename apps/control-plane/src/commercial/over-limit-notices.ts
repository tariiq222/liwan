import type { Pool } from 'pg'
import type { MailAdapter } from './mail-adapter.js'
import { completeOutbox, deferOutbox, failOutbox, leaseOutboxRow } from './outbox.js'
import type { FreeBaseLockCause } from '@liwan/commercial-contracts'
import { workspaceLines, workspaceOrigin, type ReturnOrigin } from './return-origin.js'

type LockNotice = { cause: FreeBaseLockCause }

/** The email subject and body for the cause that dropped the subscription to the free base, Arabic then English, naming the workspace when its origin is known. */
export function overLimitNotice(payload: LockNotice, origin: string | null = null): { subject: string; text: string } {
  const { subject, ar, en } = overLimitBody(payload)
  const workspace = workspaceLines(origin)
  return { subject, text: `${ar}${workspace.ar}\n${en}${workspace.en}` }
}

function overLimitBody(payload: LockNotice): { subject: string; ar: string; en: string } {
  if (payload.cause === 'refund') return { subject: 'تحديث الاشتراك بعد استرداد الدفعة',
    ar: 'سجّلنا استرداد دفعتك الأولى، فعاد اشتراكك إلى الباقة الأساسية المجانية. يمكنك شراء المزايا مجددًا من صفحة الاشتراك.',
    en: 'Your first payment was refunded, so your subscription is back on the free base. You can buy the features again from Subscription.' }
  if (payload.cause === 'cancelled') return { subject: 'انتهى اشتراكك المدفوع في LiwanOS',
    ar: 'انتهت مدة اشتراكك المدفوع بعد إلغاء التجديد، وعادت مساحة عملك إلى القاعدة المجانية. بياناتك محفوظة، والتطبيقات غير المشمولة فيها للقراءة والتصدير فقط. يمكنك الاشتراك من جديد في أي وقت من صفحة الاشتراك.',
    en: 'Your paid subscription ended after you cancelled the renewal, and your workspace is back on the free base. Your data is kept, and apps the free base does not include are read-only and exportable. You can subscribe again any time from Subscription.' }
  const subject = 'تحديث الاشتراك بعد انتهاء التجربة'
  if (payload.cause === 'first_invoice_unpaid') return { subject,
    ar: 'انتهت مهلة دفع الفاتورة الأولى. يمكنك شراء المزايا مجددًا من صفحة الاشتراك.',
    en: 'The first invoice payment grace period ended. You can buy the features again from Subscription.' }
  return { subject,
    ar: 'انتهت تجربتك. أصبحت التطبيقات غير المشتراة للقراءة والتصدير، ويُقيَّد الاستخدام الزائد. راجع الاشتراك لمعرفة ما بقي متاحًا.',
    en: 'Your trial ended. Unpurchased apps now allow reading and export. Excess usage is restricted. See Subscription for what remains available.' }
}

/**
 * Sends the notice queued when the lock applies. One email per subscription (the outbox key), leased so two workers
 * send it once; a send that fails is deferred and retried, and a customer with no address fails the row loudly.
 */
export async function sendOverLimitNotices(pool: Pool, input: { mail: MailAdapter; returnOrigin?: ReturnOrigin; signal?: AbortSignal }): Promise<number> {
  const rows = (await pool.query(`SELECT o.id,o.payload,c.id AS customer_id,c.admin_login FROM commercial_outbox o JOIN subscriptions s ON s.id::text=o.aggregate_id
    JOIN customers c ON c.id=s.customer_id WHERE o.kind='free_base.locked' AND o.status='pending' AND o.next_attempt_at <= now() ORDER BY o.created_at,o.id LIMIT 20`)).rows
  let sent = 0
  for (const row of rows) {
    if (input.signal?.aborted) return sent
    if (!await leaseOutboxRow(pool, row.id)) continue
    if (!row.admin_login) { await failOutbox(pool, row.id, 'no_recipient'); continue }
    try {
      const notice = overLimitNotice(row.payload, await workspaceOrigin(input.returnOrigin, row.customer_id))
      await input.mail.send({ to: row.admin_login, subject: notice.subject, text: notice.text, message_id: `over-limit-${row.id}@liwan` })
      await completeOutbox(pool, row.id)
      sent++
    } catch (error) { await deferOutbox(pool, row.id, error instanceof Error ? error.message.slice(0, 200) : 'over_limit_notice_failed') }
  }
  return sent
}
