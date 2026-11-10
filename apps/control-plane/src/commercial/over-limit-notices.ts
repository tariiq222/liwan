import type { Pool } from 'pg'
import type { MailAdapter } from './mail-adapter.js'
import { completeOutbox, deferOutbox, failOutbox, leaseOutboxRow } from './outbox.js'

export type OverLimit = { key: string; used: number; free: number }

/** What a limit key is called for the customer, in both languages; an unknown key is shown as it is. */
const LABELS: Record<string, { ar: (n: number) => string; en: (n: number) => string }> = {
  'users.limit': { ar: n => `${n} مستخدمين`, en: n => `${n} users` },
  'storage.limit_mb': { ar: n => `${n} ميغابايت تخزينًا`, en: n => `${n} MB of storage` },
  'branches.extra': { ar: n => `${n} فروع إضافية`, en: n => `${n} extra branches` },
}
const label = (key: string, n: number, lang: 'ar' | 'en') => LABELS[key]?.[lang](n) ?? `${key}: ${n}`

/** The text of the notice: what exceeds the free base, what that means, and that nothing is deleted. Exported for tests. */
export function overLimitText(over: OverLimit[], generic = false): string {
  if (generic) return 'انتهت تجربتك وانتقلت شركتك إلى القاعدة المجانية. التطبيقات المدفوعة مقفلة للقراءة والتصدير فقط. لم نتمكن بعد من قراءة استخدامك، لذا ستُراجَع الحدود حين يتوفر، ولم يُحذف أو يُؤرشف أي شيء من مستخدميك أو بياناتك. يمكنك الاشتراك في أي وقت لإعادة فتح التطبيقات.\n'
    + 'Your trial ended and your company moved to the free base. The paid applications are locked to read and export only. We could not read your usage yet, so the limits will be reviewed once it is available; nothing of your users or data was deleted or archived. You can subscribe at any time to reopen the applications.'
  const ar = over.map(o => `${label(o.key, o.used, 'ar')} والقاعدة المجانية تشمل ${label(o.key, o.free, 'ar')}`).join('؛ ')
  const en = over.map(o => `${label(o.key, o.used, 'en')} in use, the free base includes ${label(o.key, o.free, 'en')}`).join('; ')
  return `انتهت تجربتك وانتقلت شركتك إلى القاعدة المجانية، واستخدامك يتجاوز حدودها: ${ar}. التطبيقات المدفوعة مقفلة للقراءة والتصدير فقط. لم يُحذف أو يُؤرشف أي شيء من مستخدميك أو بياناتك، ويُمنع فقط إضافة المزيد فوق الحد. تُخفَّض الحدود تلقائيًا حين يعود استخدامك ضمنها، ويمكنك الاشتراك في أي وقت لإعادة فتح التطبيقات.\n`
    + `Your trial ended and your company moved to the free base, but your usage is above its limits: ${en}. The paid applications are locked to read and export only. Nothing of your users or data was deleted or archived; only adding more above the limit is prevented. The limits are lowered automatically once your usage fits, and you can subscribe at any time to reopen the applications.`
}

/**
 * Sends the over-limit notice queued with the lowering. One email per subscription (the outbox key), leased so two workers
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
      await input.mail.send({ to: row.admin_login, subject: 'انتقلت شركتك إلى القاعدة المجانية واستخدامك يتجاوز حدودها', text: overLimitText(row.payload.over as OverLimit[], row.payload.generic === true), message_id: `over-limit-${row.id}@liwan` })
      await completeOutbox(pool, row.id)
      sent++
    } catch (error) { await deferOutbox(pool, row.id, error instanceof Error ? error.message.slice(0, 200) : 'over_limit_notice_failed') }
  }
  return sent
}
