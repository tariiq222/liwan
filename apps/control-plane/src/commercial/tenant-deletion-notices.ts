import type { Pool } from 'pg'
import type { MailAdapter } from './mail-adapter.js'
import { completeOutbox, deferOutbox, enqueueOutbox, failOutbox, leaseOutboxRow } from './outbox.js'
import { daysText } from './billing-notices.js'
import { TENANT_DELETION_REMINDER_DAYS } from './notice-timings.js'
import { workspaceLines, workspaceOrigin, type ReturnOrigin } from './return-origin.js'
import { TENANT_DELETION_HOLD_HOURS, TENANT_DELETION_LAST_CALL_HOURS } from '@liwan/commercial-contracts'
import { DELETION_CODE_TTL_MINUTES, TENANT_DELETION_NOTICE_KIND, type DeletionNoticePayload } from './tenant-deletion.js'

type Language = 'ar' | 'en'
export type DeletionNoticeContext = { name: string; origin?: string | null; due_on: string | null; final_at: string | null; cards_unremoved?: number; relay_skipped?: boolean; renewal_outcome: string | null; renewal_refusal: string | null }

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
  ar: 'عند بدء الحذف يحذف فريق ليوان بيانات مساحة العمل وملفاتها ونسخها الاحتياطية، ولا يمكن استرجاعها بعد ذلك. نحتفظ بالفواتير وسجلات الدفع لأغراض المحاسبة.',
  en: 'When the deletion starts, the LiwanOS team deletes the workspace data, its files and its backups, and they cannot be recovered afterwards. We keep invoices and payment records for accounting.',
}
/** Until when the request can still be withdrawn: the end of the final hold (Riyadh time). */
const howToWithdraw = (until: string) => ({
  ar: `يمكنك سحب الطلب حتى ${until} بتوقيت الرياض من صفحة الاشتراك في ليوان (قسم حذف مساحة العمل)، أو بمراسلتنا. مساحتك تعمل حتى ذلك الوقت.`,
  en: `You can withdraw the request until ${until} Riyadh time from Subscription in LiwanOS (Delete workspace), or by writing to us. Your workspace keeps working until then.`,
})
/** What the deletion did to saved cards and to the TikTok relay, in words that follow what actually happened. */
const cardsSentence = (unremoved: number, language: Language) => unremoved === 0
  ? (language === 'ar' ? 'حُذفت بطاقات الدفع المحفوظة.' : 'The saved payment cards were deleted.')
  : (language === 'ar' ? 'تعذّر حذف بعض بطاقات الدفع المحفوظة عند مزود الدفع الآن؛ ستبقى محاولة حذفها قائمة وسيزيلها فريق ليوان، ولا يمكن خصم أي مبلغ منها.' : 'Some saved payment cards could not be deleted at the payment provider yet; we keep retrying and the LiwanOS team will remove them, and nothing can be charged to them.')
const relaySentence = (skipped: boolean, language: Language) => !skipped ? '' : (language === 'ar'
  ? ' لم نفصل ربط حسابات TikTok من جهتنا، فافصل تفويض التطبيق من حساب TikTok.'
  : ' We did not disconnect TikTok accounts on our side, so remove the app authorisation in your TikTok account.')
/** What the customer must remove in accounts only they hold: nothing in LiwanOS can reach them. */
const CUSTOMER_OWNED = {
  ar: 'ما لا نستطيع حذفه نيابةً عنك وعليك حذفه بنفسك: الـwebhook والرمز المميز في حسابك لدى Meta (واتساب)، والـwebhook في حساب بوابة الدفع الخاصة بك، وتفويض تطبيق TikTok.',
  en: 'What we cannot remove for you and you must remove yourself: the webhook and token in your Meta account (WhatsApp), the webhook in your own payment gateway account, and the TikTok app authorisation.',
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
  const until = context.final_at ?? ''
  const withdraw = howToWithdraw(until)
  const untilAr = `${until} بتوقيت الرياض`, untilEn = `${until} Riyadh time`
  const bodies: Record<DeletionNoticePayload['type'], { subject: string; ar: string; en: string }> = {
    requested: { subject: 'رمز تأكيد حذف مساحة العمل في LiwanOS',
      ar: `طُلب حذف مساحة عمل ${context.name}. رمز التأكيد: ${payload.code}. يعمل ${DELETION_CODE_TTL_MINUTES} دقيقة ومرة واحدة فقط، ولا يبدأ الحذف إلا بعد إدخاله مع اسم الشركة كما هو مكتوب عندنا. إن لم يطلب أحد من فريقك ذلك فتجاهل الرسالة ولن يحدث شيء، وراسلنا إن شككت في الوصول إلى حسابك.`,
      en: `Deletion of the workspace ${context.name} was requested. Confirmation code: ${payload.code}. It works for ${DELETION_CODE_TTL_MINUTES} minutes and once, and nothing starts until it is entered with the company name exactly as we hold it. If nobody on your team asked for this, ignore the message and nothing happens; write to us if you suspect someone has access to your account.` },
    confirmed: { subject: 'جدولنا حذف مساحة العمل في LiwanOS',
      ar: `جدولنا حذف مساحة عمل ${context.name}: تنتهي مهلة السحب في ${on} وتتبعها مهلة أخيرة مدتها ${TENANT_DELETION_HOLD_HOURS} ساعة. لم يُحذف شيء حتى الآن. ${WHAT_IS_DELETED.ar} ${renewalSentence(context, 'ar')} ${withdraw.ar}`,
      en: `The workspace ${context.name} is scheduled for deletion: the withdrawal window ends on ${on}, followed by a final hold of ${TENANT_DELETION_HOLD_HOURS} hours. Nothing has been deleted yet. ${WHAT_IS_DELETED.en} ${renewalSentence(context, 'en')} ${withdraw.en}` },
    reminder: { subject: 'تذكير: حذف مساحة العمل في LiwanOS يقترب',
      ar: `تبقى ${daysText(daysLeft, 'ar')} على نهاية مهلة السحب لحذف مساحة عمل ${context.name}، وهي ${on}. ${WHAT_IS_DELETED.ar} ${withdraw.ar}`,
      en: `${daysText(daysLeft, 'en')} left until the withdrawal window for deleting the workspace ${context.name} ends, on ${on}. ${WHAT_IS_DELETED.en} ${withdraw.en}` },
    withdrawn: { subject: 'سُحب طلب حذف مساحة العمل في LiwanOS',
      ar: `سُحب طلب حذف مساحة عمل ${context.name} ولن تُحذف. ${context.renewal_outcome === 'cancelled' ? 'لم نستأنف اشتراكك تلقائيًا: ما زال تجديده ملغى، فاستأنفه من صفحة الاشتراك إن أردت أن يتجدد.' : ''}`.trim(),
      en: `The deletion of the workspace ${context.name} was withdrawn and it will not be deleted. ${context.renewal_outcome === 'cancelled' ? 'We did not resume your subscription automatically: its renewal is still cancelled, so resume it from Subscription if you want it to renew.' : ''}`.trim() },
    due: { subject: 'بدأت المهلة الأخيرة لحذف مساحة العمل في LiwanOS',
      ar: `انتهت مهلة سحب طلب حذف مساحة عمل ${context.name} وبدأت مهلة أخيرة مدتها ${TENANT_DELETION_HOLD_HOURS} ساعة تنتهي في ${untilAr}. مساحتك ما زالت تعمل، ولا يزال بإمكانك سحب الطلب حتى ذلك الوقت. بعده يبدأ الحذف وتتوقف مساحتك ولا يمكن سحب الطلب. ${WHAT_IS_DELETED.ar} ${withdraw.ar}`,
      en: `The window for withdrawing the deletion of the workspace ${context.name} has ended and a final hold of ${TENANT_DELETION_HOLD_HOURS} hours started; it ends ${untilEn}. Your workspace still works and you can still withdraw the request until then. After that the deletion starts, your workspace stops and the request can no longer be withdrawn. ${WHAT_IS_DELETED.en} ${withdraw.en}` },
    last_call: { subject: 'آخر فرصة لسحب حذف مساحة العمل في LiwanOS',
      ar: `تبقت ${TENANT_DELETION_LAST_CALL_HOURS} ساعة على نهاية المهلة الأخيرة لحذف مساحة عمل ${context.name}، وهي ${untilAr}. إن أردت الاحتفاظ بمساحتك فاسحب الطلب الآن. ${withdraw.ar}`,
      en: `${TENANT_DELETION_LAST_CALL_HOURS} hours are left in the final hold for deleting the workspace ${context.name}; it ends ${untilEn}. If you want to keep your workspace, withdraw the request now. ${withdraw.en}` },
    hold_extended: { subject: 'تغيّر موعد نهاية المهلة الأخيرة لحذف مساحة العمل في LiwanOS',
      ar: `تأخّر وصول إشعار المهلة الأخيرة إليك، فمددنا مهلة حذف مساحة عمل ${context.name} لتكتمل مدتها كاملة. تنتهي المهلة الآن في ${untilAr}، ومساحتك تعمل ويمكنك سحب الطلب حتى ذلك الوقت. ${withdraw.ar}`,
      en: `Your final-hold notice reached you late, so we extended the hold for the workspace ${context.name} to give you its full length. It now ends ${untilEn}; your workspace keeps working and you can withdraw the request until then. ${withdraw.en}` },
    deleting: { subject: 'بدأ حذف مساحة العمل في LiwanOS',
      ar: `بدأ حذف مساحة عمل ${context.name} وأوقفنا الوصول إليها الآن. لم يعد بإمكانك سحب الطلب بنفسك؛ إن كان الحذف خطأً فراسلنا فورًا، ولا يمكننا التراجع بعد أن يمرّ الحذف بنقطة اللاعودة. سنرسل لك تأكيدًا عند الاكتمال.`,
      en: `The deletion of the workspace ${context.name} has started and access is stopped now. You can no longer withdraw the request yourself; if this is a mistake, write to us at once, because we cannot undo it once the deletion passes the point of no return. We will send a confirmation when it is complete.` },
    deleted: { subject: 'اكتمل حذف مساحة العمل في LiwanOS',
      ar: `اكتمل حذف مساحة عمل ${context.name}: حُذفت قاعدة البيانات والملفات والنسخ الاحتياطية. ${cardsSentence(context.cards_unremoved ?? 0, 'ar')}${relaySentence(context.relay_skipped ?? false, 'ar')} نحتفظ بالفواتير وسجلات الدفع، وبسجل يثبت أن الحذف تم، وبسجل التجربة المجانية. ${CUSTOMER_OWNED.ar} إن أردت العودة فراسلنا.`,
      en: `The deletion of the workspace ${context.name} is complete: the database, the files and the backups were deleted. ${cardsSentence(context.cards_unremoved ?? 0, 'en')}${relaySentence(context.relay_skipped ?? false, 'en')} We keep invoices and payment records, the record that the deletion happened, and the free-trial record. ${CUSTOMER_OWNED.en} If you want to come back, write to us.` },
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
      (r.due_at AT TIME ZONE 'Asia/Riyadh')::date::text AS due_on,
      COALESCE((SELECT (s.evidence->>'unremoved')::int FROM tenant_deletion_steps s WHERE s.request_id=r.id AND s.step='delete_cards'),0) AS cards_unremoved,
      EXISTS (SELECT 1 FROM tenant_deletion_steps s WHERE s.request_id=r.id AND s.step='unbind_relay' AND s.state='skipped') AS relay_skipped,
      to_char(COALESCE(r.hold_until, r.due_at + make_interval(hours => $2)) AT TIME ZONE 'Asia/Riyadh','YYYY-MM-DD HH24:MI') AS final_at,((r.due_at AT TIME ZONE 'Asia/Riyadh')::date - (now() AT TIME ZONE 'Asia/Riyadh')::date)::int AS days_left
    FROM tenant_deletion_requests r JOIN customers c ON c.id=r.customer_id WHERE r.id=$1`, [payload.request_id, TENANT_DELETION_HOLD_HOURS])).rows[0]
  if (!row) return undefined
  const live = {
    requested: row.state === 'requested' && row.code_seq === payload.seq && row.code_live === true,
    confirmed: ['confirmed', 'due'].includes(row.state),
    reminder: row.state === 'confirmed',
    withdrawn: row.state === 'withdrawn',
    due: ['due', 'deleting'].includes(row.state),
    last_call: row.state === 'due',
    hold_extended: row.state === 'due',
    deleting: row.state === 'deleting',
    deleted: row.state === 'deleted',
  }[payload.type]
  return live ? { name: row.name, customer_id: row.customer_id, admin_login: row.admin_login, due_on: row.due_on, final_at: row.final_at, cards_unremoved: row.cards_unremoved, relay_skipped: row.relay_skipped, days_left: row.days_left, renewal_outcome: row.renewal_outcome, renewal_refusal: row.renewal_refusal } : undefined
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
      await closeDelivered(pool, row.id)
      sent++
    } catch (error) { await deferOutbox(pool, row.id, error instanceof Error ? error.message.slice(0, 200) : 'tenant_deletion_notice_failed') }
  }
  return sent
}

/** A notice the customer's mailbox accepted: closed and marked delivered. A notice closed any other way (stale, no recipient) is never `delivered`. */
async function closeDelivered(pool: Pool, id: string) { await completeOutbox(pool, id); await pool.query(`UPDATE commercial_outbox SET payload = (payload - 'code') || '{"delivered":true}'::jsonb WHERE id=$1`, [id]) }
const scrubCode = (pool: Pool, id: string) => pool.query(`UPDATE commercial_outbox SET payload = payload - 'code' WHERE id=$1`, [id])
async function closeWithoutCode(pool: Pool, id: string) { await completeOutbox(pool, id); await scrubCode(pool, id) }
