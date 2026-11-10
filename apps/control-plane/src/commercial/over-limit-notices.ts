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

/** The text of the notice: what the customer keeps above the free base, what that means, and that nothing is lowered or deleted. Exported for tests. */
export function overLimitText(over: OverLimit[]): string {
  const ar = over.map(o => `${label(o.key, o.used, 'ar')} والقاعدة المجانية تشمل ${label(o.key, o.free, 'ar')}`).join('؛ ')
  const en = over.map(o => `${label(o.key, o.used, 'en')} kept, the free base includes ${label(o.key, o.free, 'en')}`).join('; ')
  const branchesNoteAr = over.some(o => o.key === 'branches.extra') ? ' الفروع الإضافية التي أنشأتها خلال التجربة تبقى فعّالة دون رسوم إلى أن تشتري فرعًا جديدًا، وعندها يُسعَّر كل فرع فعّال فوق عدد الفروع المضمَّن في باقتك.' : ''
  const branchesNoteEn = over.some(o => o.key === 'branches.extra') ? ' The extra branches you created during the trial stay active at no charge until you next buy a branch; from then on every active branch above the number included in your plan is priced.' : ''
  return `انتهت تجربتك وانتقلت شركتك إلى القاعدة المجانية، وتحتفظ بما يتجاوز حدودها: ${ar}. التطبيقات المدفوعة مقفلة للقراءة والتصدير فقط. لم يُحذف أو يُؤرشف أو يُخفَّض أي شيء من مستخدميك أو بياناتك، ويبقى ما تحتفظ به معك دون رسوم إلى أن تطلب أنت كمية بنفسك.${branchesNoteAr} يمكنك الاشتراك في أي وقت لإعادة فتح التطبيقات.\n`
    + `Your trial ended and your company moved to the free base, and you keep more than it includes: ${en}. The paid applications are locked to read and export only. Nothing of your users or data was deleted, archived or lowered; what you keep stays with you at no charge until you request a quantity yourself.${branchesNoteEn} You can subscribe at any time to reopen the applications.`
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
      await input.mail.send({ to: row.admin_login, subject: 'انتقلت شركتك إلى القاعدة المجانية واستخدامك يتجاوز حدودها', text: overLimitText(row.payload.over as OverLimit[]), message_id: `over-limit-${row.id}@liwan` })
      await completeOutbox(pool, row.id)
      sent++
    } catch (error) { await deferOutbox(pool, row.id, error instanceof Error ? error.message.slice(0, 200) : 'over_limit_notice_failed') }
  }
  return sent
}
