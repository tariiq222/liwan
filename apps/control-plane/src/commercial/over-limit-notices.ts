import type { Pool } from 'pg'
import type { MailAdapter } from './mail-adapter.js'
import { completeOutbox, deferOutbox, failOutbox, leaseOutboxRow } from './outbox.js'

export function overLimitText(payload: { force_empty: boolean }): string {
  if (payload.force_empty) return 'انتهت مهلة دفع الفاتورة الأولى. يمكنك شراء المزايا مجددًا من صفحة الاشتراك.\nThe first invoice payment grace period ended. You can buy the features again from Subscription.'
  return 'انتهت تجربتك. أصبحت التطبيقات غير المشتراة للقراءة والتصدير، ويُقيَّد الاستخدام الزائد. راجع الاشتراك لمعرفة ما بقي متاحًا.\nYour trial ended. Unpurchased apps now allow reading and export. Excess usage is restricted. See Subscription for what remains available.'
}

/**
 * Sends the notice queued when the lock applies. One email per subscription (the outbox key), leased so two workers
 * send it once; a send that fails is deferred and retried, and a customer with no address fails the row loudly.
 */
export async function sendOverLimitNotices(pool: Pool, input: { mail: MailAdapter; signal?: AbortSignal }): Promise<number> {
  const rows = (await pool.query(`SELECT o.id,o.payload,c.admin_login FROM commercial_outbox o JOIN subscriptions s ON s.id::text=o.aggregate_id
    JOIN customers c ON c.id=s.customer_id WHERE o.kind='trial.over_limit' AND o.status='pending' AND o.next_attempt_at <= now() ORDER BY o.created_at,o.id LIMIT 20`)).rows
  let sent = 0
  for (const row of rows) {
    if (input.signal?.aborted) return sent
    if (!await leaseOutboxRow(pool, row.id)) continue
    if (!row.admin_login) { await failOutbox(pool, row.id, 'no_recipient'); continue }
    try {
      await input.mail.send({ to: row.admin_login, subject: 'تحديث الاشتراك بعد انتهاء التجربة', text: overLimitText(row.payload), message_id: `over-limit-${row.id}@liwan` })
      await completeOutbox(pool, row.id)
      sent++
    } catch (error) { await deferOutbox(pool, row.id, error instanceof Error ? error.message.slice(0, 200) : 'over_limit_notice_failed') }
  }
  return sent
}
