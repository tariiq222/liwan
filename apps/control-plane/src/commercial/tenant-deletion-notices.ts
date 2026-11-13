import type { Pool } from 'pg'
import type { MailAdapter } from './mail-adapter.js'
import { completeOutbox, deferOutbox, enqueueOutbox, failOutbox, leaseOutboxRow } from './outbox.js'
import { daysText } from './billing-notices.js'
import { TENANT_DELETION_REMINDER_DAYS } from './notice-timings.js'
import { workspaceLines, workspaceOrigin, type ReturnOrigin } from './return-origin.js'
import { DELETION_CODE_TTL_MINUTES, TENANT_DELETION_NOTICE_KIND, type DeletionNoticePayload } from './tenant-deletion.js'

type Language = 'ar' | 'en'
export type DeletionNoticeContext = { name: string; origin?: string | null; due_on: string | null; renewal_outcome: string | null; renewal_refusal: string | null }

/** Why the paid renewal could not be stopped, in words, for the customer and the owner. */
const REFUSAL_WORDS: Record<string, Record<Language, string>> = {
  nothing_to_cancel: { ar: 'مساحتك على القاعدة المجانية', en: 'your workspace is on the free base' },
  no_subscription: { ar: 'لا يوجد اشتراك', en: 'there is no subscription' },
  cancel_trial_unsupported: { ar: 'الاشتراك تجربة وتنتهي وحدها', en: 'the subscription is a trial and ends by itself' },
  subscription_past_due: { ar: 'عليك فاتورة متأخرة', en: 'an invoice is overdue' },
  lock_pending: { ar: 'يجري تطبيق انتقال إلى القاعدة المجانية', en: 'a move to the free base is being applied' },
  subscription_suspended: { ar: 'الاشتراك موقوف', en: 'the subscription is suspended' },
  subscription_change_pending: { ar: 'هناك تغيير في الاشتراك قيد المعالجة', en: 'a subscription change is still being processed' },
  renewal_in_progress: { ar: 'يجري تطبيق تجديد مدفوع', en: 'a paid renewal is being applied' },
  subscription_required: { ar: 'الاشتراك بلا باقة مطبّقة', en: 'the subscription has no applied plan' },
}
const FREE_BASE_REFUSALS = ['nothing_to_cancel', 'no_subscription']

/** The reason a renewal was not stopped, in words; unknown codes are named rather than hidden. */
export const refusalWords = (refusal: string | null, language: Language) => REFUSAL_WORDS[refusal ?? '']?.[language] ?? refusal ?? ''
/** True when the renewal was not stopped and a paid subscription may still bill: the free base and a missing subscription owe nothing. */
export const renewalMayStillBill = (outcome: string | null, refusal: string | null) => outcome === 'not_cancellable' && !FREE_BASE_REFUSALS.includes(refusal ?? '')

const WHAT_IS_DELETED = {
  ar: 'في ذلك التاريخ يحذف فريق ليوان بيانات مساحة العمل وملفاتها ونسخها الاحتياطية، ولا يمكن استرجاعها بعد ذلك. نحتفظ بالفواتير وسجلات الدفع لأغراض المحاسبة.',
  en: 'On that date the LiwanOS team deletes the workspace data, its files and its backups, and they cannot be recovered afterwards. We keep invoices and payment records for accounting.',
}
const HOW_TO_WITHDRAW = {
  ar: 'يمكنك سحب الطلب حتى ذلك التاريخ من صفحة الاشتراك في ليوان (قسم حذف مساحة العمل)، أو بمراسلتنا.',
  en: 'You can withdraw the request until that date from Subscription in LiwanOS (Delete workspace), or by writing to us.',
}

/** What confirming did to the paid renewal, in words; a renewal that could not be stopped says why and that billing may go on. */
function renewalSentence(context: DeletionNoticeContext, language: Language): string {
  const { renewal_outcome: outcome, renewal_refusal: refusal } = context
  if (outcome === 'cancelled') return language === 'ar'
    ? 'ألغينا تجديد اشتراكك المدفوع حتى لا تُفوتَر مرة أخرى. لا نرد مبالغ مدفوعة بسبب الحذف.'
    : 'We cancelled the renewal of your paid subscription so you are not billed again. A deletion does not refund what you already paid.'
  if (outcome === 'already_cancelled') return language === 'ar' ? 'تجديد اشتراكك ملغى أصلًا.' : 'Your subscription renewal was already cancelled.'
  if (!renewalMayStillBill(outcome, refusal)) return language === 'ar' ? 'مساحتك على القاعدة المجانية، فلا يوجد اشتراك مدفوع يتجدد.' : 'Your workspace is on the free base, so there is no paid renewal.'
  return language === 'ar'
    ? `لم نوقف تجديد اشتراكك المدفوع لأن ${refusalWords(refusal, 'ar')}. لن نفتح فترة مدفوعة جديدة لمساحتك، لكن ما أُصدر من فواتير يبقى مستحقًا. راسلنا إن أردت إيقاف الاشتراك.`
    : `We did not stop your paid subscription from renewing because ${refusalWords(refusal, 'en')}. We will not open a new paid period for your workspace, but invoices already issued stay due. Write to us if you want the subscription stopped.`
}

/** The subject and body (Arabic, then English) of one deletion notice. Nothing has been deleted when any of these is sent but the last. */
export function tenantDeletionNotice(payload: DeletionNoticePayload, context: DeletionNoticeContext, daysLeft: number): { subject: string; text: string } {
  const on = context.due_on ?? ''
  const bodies: Record<DeletionNoticePayload['type'], { subject: string; ar: string; en: string }> = {
    requested: { subject: 'رمز تأكيد حذف مساحة العمل في LiwanOS',
      ar: `طُلب حذف مساحة عمل ${context.name}. رمز التأكيد: ${payload.code}. يعمل ${DELETION_CODE_TTL_MINUTES} دقيقة ومرة واحدة فقط، ولا يبدأ الحذف إلا بعد إدخاله مع اسم الشركة كما هو مكتوب عندنا. إن لم يطلب أحد من فريقك ذلك فتجاهل الرسالة ولن يحدث شيء، وراسلنا إن شككت في الوصول إلى حسابك.`,
      en: `Deletion of the workspace ${context.name} was requested. Confirmation code: ${payload.code}. It works for ${DELETION_CODE_TTL_MINUTES} minutes and once, and nothing starts until it is entered with the company name exactly as we hold it. If nobody on your team asked for this, ignore the message and nothing happens; write to us if you suspect someone has access to your account.` },
    confirmed: { subject: 'جدولنا حذف مساحة العمل في LiwanOS',
      ar: `جدولنا حذف مساحة عمل ${context.name} في ${on}. لم يُحذف شيء حتى الآن. ${WHAT_IS_DELETED.ar} ${renewalSentence(context, 'ar')} ${HOW_TO_WITHDRAW.ar}`,
      en: `The workspace ${context.name} is scheduled for deletion on ${on}. Nothing has been deleted yet. ${WHAT_IS_DELETED.en} ${renewalSentence(context, 'en')} ${HOW_TO_WITHDRAW.en}` },
    reminder: { subject: 'تذكير: حذف مساحة العمل في LiwanOS يقترب',
      ar: `تبقى ${daysText(daysLeft, 'ar')} على الموعد المجدول لحذف مساحة عمل ${context.name}، وهو ${on}. ${WHAT_IS_DELETED.ar} ${HOW_TO_WITHDRAW.ar}`,
      en: `${daysText(daysLeft, 'en')} left until the workspace ${context.name} is scheduled for deletion, on ${on}. ${WHAT_IS_DELETED.en} ${HOW_TO_WITHDRAW.en}` },
    withdrawn: { subject: 'سُحب طلب حذف مساحة العمل في LiwanOS',
      ar: `سُحب طلب حذف مساحة عمل ${context.name} ولن تُحذف. ${context.renewal_outcome === 'cancelled' ? 'لم نستأنف اشتراكك تلقائيًا: ما زال تجديده ملغى، فاستأنفه من صفحة الاشتراك إن أردت أن يتجدد.' : ''}`.trim(),
      en: `The deletion of the workspace ${context.name} was withdrawn and it will not be deleted. ${context.renewal_outcome === 'cancelled' ? 'We did not resume your subscription automatically: its renewal is still cancelled, so resume it from Subscription if you want it to renew.' : ''}`.trim() },
    due: { subject: 'انتهت مهلة حذف مساحة العمل في LiwanOS',
      ar: `انتهت مهلة حذف مساحة عمل ${context.name}، ولم يعد سحب الطلب ممكنًا. سينفّذ فريق ليوان الحذف، وسنرسل لك تأكيدًا عند اكتماله.`,
      en: `The window for deleting the workspace ${context.name} has ended and the request can no longer be withdrawn. The LiwanOS team will carry out the deletion and we will send you a confirmation when it is complete.` },
  }
  const body = bodies[payload.type]
  const workspace = workspaceLines(context.origin ?? null)
  return { subject: body.subject, text: `${body.ar}${workspace.ar}\n${body.en}${workspace.en}` }
}

/**
 * Queues the reminder for each confirmed request: the nearest threshold of TENANT_DELETION_REMINDER_DAYS that is not yet behind it, once.
 * After a worker outage the thresholds it missed are skipped, never sent late in a batch. Days are counted on the database clock in the business zone.
 */
async function queueReminders(pool: Pool): Promise<void> {
  const rows = (await pool.query(`SELECT id,((due_at AT TIME ZONE 'Asia/Riyadh')::date - (now() AT TIME ZONE 'Asia/Riyadh')::date)::int AS days_left
    FROM tenant_deletion_requests WHERE state='confirmed'`)).rows as { id: string; days_left: number }[]
  for (const row of rows) {
    const threshold = [...TENANT_DELETION_REMINDER_DAYS].sort((a, b) => a - b).find(days => row.days_left <= days)
    if (threshold === undefined || row.days_left < 1) continue
    await enqueueOutbox(pool, { kind: TENANT_DELETION_NOTICE_KIND, aggregate_id: row.id, dedupe_key: `reminder:${row.id}:${threshold}`,
      payload: { type: 'reminder', request_id: row.id, days: threshold } satisfies DeletionNoticePayload })
  }
}

/** The recipient and wording context when the request is still in the state the notice is about; undefined when it moved on and the notice is stale. */
async function liveContext(pool: Pool, payload: DeletionNoticePayload): Promise<(DeletionNoticeContext & { customer_id: string; admin_login: string | null; days_left: number }) | undefined> {
  const row = (await pool.query(`SELECT r.state,r.code_seq,(r.code_expires_at > now()) AS code_live,r.renewal_outcome,r.renewal_refusal,c.name,c.id AS customer_id,c.admin_login,
      (r.due_at AT TIME ZONE 'Asia/Riyadh')::date::text AS due_on,((r.due_at AT TIME ZONE 'Asia/Riyadh')::date - (now() AT TIME ZONE 'Asia/Riyadh')::date)::int AS days_left
    FROM tenant_deletion_requests r JOIN customers c ON c.id=r.customer_id WHERE r.id=$1`, [payload.request_id])).rows[0]
  if (!row) return undefined
  const live = {
    requested: row.state === 'requested' && row.code_seq === payload.seq && row.code_live === true,
    confirmed: row.state === 'confirmed' || row.state === 'due',
    reminder: row.state === 'confirmed',
    withdrawn: row.state === 'withdrawn',
    due: row.state === 'due',
  }[payload.type]
  return live ? { name: row.name, customer_id: row.customer_id, admin_login: row.admin_login, due_on: row.due_on, days_left: row.days_left, renewal_outcome: row.renewal_outcome, renewal_refusal: row.renewal_refusal } : undefined
}

/**
 * Sends every pending deletion notice to the customer's address on record, Arabic then English, each once. A row is leased so two
 * workers send it once and is checked against the live request just before sending: a code mail for a request that moved on, or a
 * reminder for a withdrawn one, is closed. The emailed code is scrubbed from the row as soon as it is handled.
 */
export async function sendTenantDeletionNotices(pool: Pool, input: { mail: MailAdapter; returnOrigin?: ReturnOrigin; signal?: AbortSignal }): Promise<number> {
  if (input.signal?.aborted) return 0
  await queueReminders(pool)
  const rows = (await pool.query(`SELECT id,payload FROM commercial_outbox WHERE kind=$1 AND status='pending' AND next_attempt_at <= now() ORDER BY created_at,id LIMIT 50`,
    [TENANT_DELETION_NOTICE_KIND])).rows as { id: string; payload: DeletionNoticePayload }[]
  let sent = 0
  for (const row of rows) {
    if (input.signal?.aborted) return sent
    if (!await leaseOutboxRow(pool, row.id)) continue
    try {
      const context = await liveContext(pool, row.payload)
      if (!context) { await closeWithoutCode(pool, row.id); continue }
      if (!context.admin_login) { await failOutbox(pool, row.id, 'no_recipient'); await scrubCode(pool, row.id); continue }
      const notice = tenantDeletionNotice(row.payload, { ...context, origin: await workspaceOrigin(input.returnOrigin, context.customer_id) }, context.days_left)
      await input.mail.send({ to: context.admin_login, subject: notice.subject, text: notice.text, message_id: `tenant-deletion-${row.id}@liwan` })
      await closeWithoutCode(pool, row.id)
      sent++
    } catch (error) { await deferOutbox(pool, row.id, error instanceof Error ? error.message.slice(0, 200) : 'tenant_deletion_notice_failed') }
  }
  return sent
}

const scrubCode = (pool: Pool, id: string) => pool.query(`UPDATE commercial_outbox SET payload = payload - 'code' WHERE id=$1`, [id])
async function closeWithoutCode(pool: Pool, id: string) { await completeOutbox(pool, id); await scrubCode(pool, id) }
