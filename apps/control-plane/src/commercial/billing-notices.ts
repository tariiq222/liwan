import type { Pool } from 'pg'
import { addCadence, daysBetween, riyadhDate, type Cadence } from '@liwan/commercial-contracts'
import type { MailAdapter } from './mail-adapter.js'
import { completeOutbox, deferOutbox, enqueueOutbox, failOutbox, leaseOutboxRow } from './outbox.js'
import { holdsFreeBaseLockSql, owesAtRenewal } from './free-base.js'
import { RENEWAL_NOTICE_DAYS, SUSPENSION_NOTICE_DAYS } from './notice-timings.js'
import type { ReturnOrigin } from './return-origin.js'

export const BILLING_NOTICE_KIND = 'billing.notice'
export type BillingNoticeType = 'renewal_upcoming' | 'overdue' | 'suspension_warning' | 'suspended' | 'payment_received'
type Money = { minor: number; currency: string; exponent: number }
type Payload = { type: BillingNoticeType; subscription_id: string; invoice_id?: string; renewal_on?: string; grace_ends_on?: string; amount?: Money }

/**
 * Queues one billing notice. The dedupe key names the event (the invoice, the renewal date, the grace end and the
 * threshold), so a re-run, a restart or a late scan never queues the same notice twice. Callers that change a state pass
 * their own transaction so the notice cannot be missed.
 */
export async function enqueueBillingNotice(client: Parameters<typeof enqueueOutbox>[0], dedupe: string, payload: Payload): Promise<boolean> {
  return enqueueOutbox(client, { kind: BILLING_NOTICE_KIND, aggregate_id: payload.subscription_id, dedupe_key: dedupe, payload })
}

/** The tightest threshold already reached, so a scan that ran late sends one notice rather than every missed one. */
const reached = (thresholds: readonly number[], daysLeft: number) => thresholds.filter(days => daysLeft <= days).sort((a, b) => a - b)[0]

/**
 * Queues the notices that depend on the calendar: a renewal that is coming and a suspension that is coming. The
 * threshold is the dedupe key, so each is queued once per renewal date or grace end. Notices that follow a state
 * change (overdue, suspended, payment received) are queued by the code that makes the change.
 */
export async function queueScheduledBillingNotices(pool: Pool, now: Date): Promise<number> {
  const today = riyadhDate(now)
  let queued = 0
  const upcoming = (await pool.query(`SELECT s.id,s.renewal_at::text AS renewal_on,sr.snapshot->'pricing' AS pricing,sr.snapshot->'cadence' AS cadence
    FROM subscriptions s JOIN subscription_revisions sr ON sr.id=s.applied_revision_id
    WHERE s.state='active' AND NOT s.manual_suspension AND s.renewal_at IS NOT NULL AND s.renewal_at <= $1::date + $2::int
    AND NOT ${holdsFreeBaseLockSql('s')} AND s.cancel_requested_at IS NULL ORDER BY s.id`, [today, Math.max(...RENEWAL_NOTICE_DAYS)])).rows
  for (const row of upcoming) {
    if (!owesAtRenewal(row.pricing)) continue
    const daysLeft = daysBetween(today, row.renewal_on)
    if (daysLeft < 1) continue
    const cadenceDays = daysBetween(row.renewal_on, addCadence(row.renewal_on, row.cadence as Cadence, 1))
    const threshold = reached(RENEWAL_NOTICE_DAYS.filter(days => days < cadenceDays), daysLeft)
    if (threshold !== undefined && await enqueueBillingNotice(pool, `renewal_upcoming:${row.id}:${row.renewal_on}:${threshold}`,
      { type: 'renewal_upcoming', subscription_id: row.id, renewal_on: row.renewal_on })) queued++
  }
  const ending = (await pool.query(`SELECT s.id,s.grace_ends_at,p.grace_days FROM subscriptions s
    JOIN subscription_revisions sr ON sr.id=s.applied_revision_id JOIN plan_revisions p ON p.id=(sr.snapshot->>'plan_revision_id')::uuid
    WHERE s.state='past_due' AND NOT s.manual_suspension AND s.grace_ends_at IS NOT NULL AND p.auto_suspend
    AND NOT ${holdsFreeBaseLockSql('s')} ORDER BY s.id`)).rows
  for (const row of ending) {
    const graceEnds = riyadhDate(new Date(row.grace_ends_at))
    const daysLeft = daysBetween(today, graceEnds)
    if (daysLeft < 1) continue
    const threshold = reached(SUSPENSION_NOTICE_DAYS.filter(days => days < Number(row.grace_days)), daysLeft)
    if (threshold !== undefined && await enqueueBillingNotice(pool, `suspension_warning:${row.id}:${graceEnds}:${threshold}`,
      { type: 'suspension_warning', subscription_id: row.id, grace_ends_on: graceEnds })) queued++
  }
  return queued
}

const formatMoney = (m: Money) => `${(m.minor / 10 ** m.exponent).toFixed(m.exponent)} ${m.currency}`

/** "1 day" / "2 days" / "N days" in each language: Arabic has its own forms for 1, 2, 3-10 and 11 or more. */
export function daysText(days: number, language: 'ar' | 'en'): string {
  if (language === 'en') return days === 1 ? '1 day' : `${days} days`
  if (days === 1) return 'يوم واحد'
  if (days === 2) return 'يومان'
  return days <= 10 ? `${days} أيام` : `${days} يومًا`
}

/** The subject and body (Arabic, then English) of one notice; `link` is the customer's subscription page when it is known. */
export function billingNotice(payload: Payload, daysLeft: number, autoSuspend: boolean, link: string | null): { subject: string; text: string } {
  const tail = link ? { ar: `\nصفحة الاشتراك: ${link}`, en: `\nSubscription: ${link}` } : { ar: '', en: '' }
  const bodies: Record<BillingNoticeType, { subject: string; ar: string; en: string }> = {
    renewal_upcoming: { subject: 'اشتراكك في LiwanOS يتجدد قريبًا',
      ar: `يتجدد اشتراكك في ${payload.renewal_on} (المتبقي ${daysText(daysLeft, 'ar')}). ستصدر فاتورة التجديد في ذلك اليوم، وتجد طريقة الدفع في صفحة الاشتراك.`,
      en: `Your subscription renews on ${payload.renewal_on} (${daysText(daysLeft, 'en')} left). The renewal invoice is issued that day and you can pay it from Subscription.` },
    overdue: { subject: 'فاتورة اشتراكك في LiwanOS لم تُسدَّد',
      ar: autoSuspend ? `لم نستلم دفعة فاتورة اشتراكك في موعدها. ادفعها قبل ${payload.grace_ends_on} حتى تبقى الكتابة متاحة، وإلا يُعلَّق الاشتراك وتصبح مساحة العمل للقراءة والتصدير فقط.`
        : 'لم نستلم دفعة فاتورة اشتراكك في موعدها. ادفعها في أقرب وقت من صفحة الاشتراك.',
      en: autoSuspend ? `We have not received payment for your subscription invoice. Pay it before ${payload.grace_ends_on} to keep editing, or the subscription is suspended and your workspace becomes read-only.`
        : 'We have not received payment for your subscription invoice. Please pay it as soon as possible from Subscription.' },
    suspension_warning: { subject: 'ستصبح مساحة عملك في LiwanOS للقراءة فقط قريبًا',
      ar: `سيُعلَّق اشتراكك في ${payload.grace_ends_on} (المتبقي ${daysText(daysLeft, 'ar')}) إذا بقيت الفاتورة دون سداد، وعندها تصبح مساحة العمل للقراءة والتصدير فقط. ادفعها من صفحة الاشتراك لإبقاء الكتابة متاحة.`,
      en: `Your subscription is suspended on ${payload.grace_ends_on} (${daysText(daysLeft, 'en')} left) if the invoice stays unpaid, and your workspace becomes read-only (view and export only). Pay it from Subscription to keep editing.` },
    suspended: { subject: 'عُلِّق اشتراكك في LiwanOS',
      ar: 'عُلِّق اشتراكك بسبب فاتورة لم تُسدَّد، فصارت مساحة العمل للقراءة والتصدير فقط. ادفعها من صفحة الاشتراك، وتعود الكتابة تلقائيًا بعد وصول الدفعة.',
      en: 'Your subscription is suspended because an invoice is unpaid, so your workspace is read-only (you can still view and export). Pay it from Subscription and editing returns automatically once the payment arrives.' },
    payment_received: { subject: 'استلمنا دفعتك في LiwanOS',
      ar: `استلمنا دفعتك${payload.amount ? ` بقيمة ${formatMoney(payload.amount)}` : ''}. شكرًا لك.`,
      en: `We received your payment${payload.amount ? ` of ${formatMoney(payload.amount)}` : ''}. Thank you.` },
  }
  const body = bodies[payload.type]
  return { subject: body.subject, text: `${body.ar}${tail.ar}\n${body.en}${tail.en}` }
}

type Context = { admin_login: string | null; state: string; manual_suspension: boolean; renewal_on: string | null; grace_ends_at: Date | null
  pricing: any; auto_suspend: boolean; locked: boolean; invoice_status: string | null }

async function contextOf(pool: Pool, payload: Payload): Promise<Context | undefined> {
  return (await pool.query(`SELECT c.admin_login,s.state,s.manual_suspension,s.renewal_at::text AS renewal_on,s.grace_ends_at,sr.snapshot->'pricing' AS pricing,
      COALESCE(p.auto_suspend,false) AS auto_suspend,${holdsFreeBaseLockSql('s')} AS locked,
      (SELECT i.status FROM invoices i WHERE i.id=$2::uuid) AS invoice_status
    FROM subscriptions s JOIN customers c ON c.id=s.customer_id LEFT JOIN subscription_revisions sr ON sr.id=s.applied_revision_id
    LEFT JOIN plan_revisions p ON p.id=(sr.snapshot->>'plan_revision_id')::uuid WHERE s.id=$1`, [payload.subscription_id, payload.invoice_id ?? null])).rows[0]
}

/** Whether the notice is still true now, judged on the live rows rather than on the moment it was queued. */
function stillTrue(payload: Payload, ctx: Context, today: string): boolean {
  switch (payload.type) {
    case 'payment_received': return ctx.invoice_status === 'paid'
    case 'suspended': return ctx.state === 'suspended' && !ctx.manual_suspension
    case 'overdue': return ctx.state === 'past_due' && !ctx.manual_suspension && !ctx.locked && ctx.invoice_status === 'issued'
    case 'suspension_warning': return ctx.state === 'past_due' && !ctx.manual_suspension && !ctx.locked && ctx.auto_suspend && !!ctx.grace_ends_at
      && riyadhDate(ctx.grace_ends_at) === payload.grace_ends_on && daysBetween(today, payload.grace_ends_on!) >= 1
    case 'renewal_upcoming': return ctx.state === 'active' && !ctx.manual_suspension && !ctx.locked && owesAtRenewal(ctx.pricing)
      && ctx.renewal_on === payload.renewal_on && daysBetween(today, payload.renewal_on!) >= 1
  }
}

/**
 * Queues the scheduled notices, then sends every pending billing notice. Each row is leased so two workers send it once,
 * is re-checked against the live subscription just before sending (a notice that stopped being true is closed, not sent),
 * and a failed send is deferred with a backoff and retried; a customer with no address fails the row loudly.
 */
export async function sendBillingNotices(pool: Pool, input: { now: Date; mail: MailAdapter; returnOrigin?: ReturnOrigin; signal?: AbortSignal }): Promise<number> {
  if (input.signal?.aborted) return 0
  await queueScheduledBillingNotices(pool, input.now)
  const rows = (await pool.query(`SELECT id,payload FROM commercial_outbox WHERE kind=$1 AND status='pending' AND next_attempt_at <= now()
    ORDER BY created_at,id LIMIT 50`, [BILLING_NOTICE_KIND])).rows as { id: string; payload: Payload }[]
  const today = riyadhDate(input.now)
  let sent = 0
  for (const row of rows) {
    if (input.signal?.aborted) return sent
    if (!await leaseOutboxRow(pool, row.id)) continue
    try {
      const ctx = await contextOf(pool, row.payload)
      if (!ctx || !stillTrue(row.payload, ctx, today)) { await completeOutbox(pool, row.id); continue }
      if (!ctx.admin_login) { await failOutbox(pool, row.id, 'no_recipient'); continue }
      const anchor = row.payload.renewal_on ?? row.payload.grace_ends_on
      const notice = billingNotice(row.payload, anchor ? daysBetween(today, anchor) : 0, ctx.auto_suspend, await subscriptionLink(input.returnOrigin, pool, row.payload.subscription_id))
      await input.mail.send({ to: ctx.admin_login, subject: notice.subject, text: notice.text, message_id: `billing-${row.id}@liwan` })
      await completeOutbox(pool, row.id)
      sent++
    } catch (error) { await deferOutbox(pool, row.id, error instanceof Error ? error.message.slice(0, 200) : 'billing_notice_failed') }
  }
  return sent
}

/** The customer's subscription page on its own origin; a customer with no usable origin gets the notice without a link. */
async function subscriptionLink(returnOrigin: ReturnOrigin | undefined, pool: Pool, subscriptionId: string): Promise<string | null> {
  if (!returnOrigin) return null
  const customer = (await pool.query('SELECT customer_id FROM subscriptions WHERE id=$1', [subscriptionId])).rows[0]?.customer_id
  if (!customer) return null
  try { return `${await returnOrigin(customer)}/subscription` } catch { return null }
}
