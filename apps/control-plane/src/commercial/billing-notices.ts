import type { Pool } from 'pg'
import { addCadence, cardExpired, cardLastValidDate, daysBetween, riyadhDate, type Cadence } from '@liwan/commercial-contracts'
import type { MailAdapter } from './mail-adapter.js'
import { completeOutbox, deferOutbox, enqueueOutbox, failOutbox, leaseOutboxRow } from './outbox.js'
import { holdsFreeBaseLockSql, owesAtRenewal } from './free-base.js'
import { CARD_EXPIRY_NOTICE_DAYS, RENEWAL_NOTICE_DAYS, SUSPENSION_NOTICE_DAYS, chargeDueOn } from './notice-timings.js'
import { MIN_CHARGE_MINOR } from './payment-adapter.js'
import { workspaceLines, workspaceOrigin, type ReturnOrigin } from './return-origin.js'

export const BILLING_NOTICE_KIND = 'billing.notice'
export type BillingNoticeType = 'renewal_upcoming' | 'overdue' | 'suspension_warning' | 'suspended' | 'payment_received' | 'card_charge_failed' | 'card_charge_skipped' | 'card_expiring'
/** Why an automatic charge that was promised, or due, cannot be made: the invoice is paid by hand. */
export type SkipReason = 'card_unusable' | 'plan_not_allowed' | 'amount_below_minimum' | 'charge_refused'
type Money = { minor: number; currency: string; exponent: number }
type Payload = { type: BillingNoticeType; subscription_id: string; invoice_id?: string; renewal_on?: string; grace_ends_on?: string; amount?: Money
  /** `card_charge_failed`: whether the decline is one a later try can pass (the next try itself is worked out when the notice is sent). */
  decline?: 'soft' | 'hard'
  /** `card_charge_skipped`: why no automatic charge is made. */
  skip_reason?: SkipReason
  /** `card_expiring`: the saved card the notice is about, and the last day it is valid. */
  payment_method_id?: string; expires_on?: string }

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
 * Queues the notices that depend on the calendar: a renewal that is coming, a saved card that is about to expire and a suspension that is coming. The
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
  const cards = (await pool.query(`SELECT s.id AS subscription_id,m.id AS payment_method_id,m.exp_month,m.exp_year FROM subscriptions s
    JOIN payment_methods m ON m.customer_id=s.customer_id AND m.is_default AND m.status='active'
    WHERE s.state IN ('active','past_due') AND NOT s.manual_suspension AND s.auto_renew_enabled AND s.cancel_requested_at IS NULL
    AND NOT ${holdsFreeBaseLockSql('s')} ORDER BY s.id`)).rows
  for (const card of cards) {
    const expiresOn = cardLastValidDate(card)
    const daysLeft = daysBetween(today, expiresOn)
    if (daysLeft < 0) continue
    const threshold = reached(CARD_EXPIRY_NOTICE_DAYS, daysLeft)
    if (threshold !== undefined && await enqueueBillingNotice(pool, `card_expiring:${card.payment_method_id}:${threshold}`,
      { type: 'card_expiring', subscription_id: card.subscription_id, payment_method_id: card.payment_method_id, expires_on: expiresOn })) queued++
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

/** What a notice may say about the saved card: its brand and last four digits, never more. */
export type NoticeCard = { brand: string; last_four: string }
/** What the notice needs beyond its payload, read from the live rows when it is sent. */
export type NoticeFacts = { autoSuspend: boolean; origin: string | null; autoRenewCard: NoticeCard | null; card: NoticeCard | null; renewalAmount: Money | null
  /** The day of the next automatic try, only while one can still happen before the subscription is suspended. */
  retryOn: string | null
  /** Automatic renewal is on but the renewal cannot be charged to the card, and why. */
  autoRenewBlocked: SkipReason | null }
const NO_FACTS: NoticeFacts = { autoSuspend: true, origin: null, autoRenewCard: null, card: null, renewalAmount: null, retryOn: null, autoRenewBlocked: null }
const SKIP_WORDS: Record<SkipReason, { ar: string; en: string }> = {
  card_unusable: { ar: 'بطاقتك المحفوظة لا يمكن خصمها (منتهية أو غير صالحة أو غير مدعومة عند مزود الدفع الحالي)', en: 'your saved card cannot be charged (expired, not valid or not supported by the current payment provider)' },
  plan_not_allowed: { ar: 'باقتك لا تتيح التجديد التلقائي', en: 'your plan does not allow automatic renewal' },
  amount_below_minimum: { ar: 'قيمة الفاتورة أقل من الحد الأدنى للدفع بالبطاقة', en: 'the invoice is below the minimum for a card payment' },
  charge_refused: { ar: 'رفض مزود الدفع طلب الخصم نفسه', en: 'the payment provider refused the charge request itself' },
}
const cardText = (card: NoticeCard, language: 'ar' | 'en') => language === 'ar' ? `بطاقة ${card.brand} المنتهية بـ ${card.last_four}` : `your ${card.brand} card ending ${card.last_four}`

/**
 * The subject and body (Arabic, then English) of one notice; `origin` is the customer's workspace when it is known: the notice names it and
 * links its subscription page. `autoRenewCard` is the card an automatic renewal will charge, set only while automatic renewal is on and a card can be charged.
 */
export function billingNotice(payload: Payload, daysLeft: number, facts: Partial<NoticeFacts> = {}): { subject: string; text: string } {
  const { autoSuspend, origin, autoRenewCard, card, renewalAmount, retryOn, autoRenewBlocked } = { ...NO_FACTS, ...facts }
  const workspace = workspaceLines(origin)
  const tail = origin ? { ar: `${workspace.ar}\nصفحة الاشتراك: ${origin}/subscription`, en: `${workspace.en}\nSubscription: ${origin}/subscription` } : workspace
  const bodies: Record<BillingNoticeType, { subject: string; ar: string; en: string }> = {
    renewal_upcoming: { subject: 'اشتراكك في LiwanOS يتجدد قريبًا',
      ar: autoRenewCard
        ? `يتجدد اشتراكك في ${payload.renewal_on} (المتبقي ${daysText(daysLeft, 'ar')}). ستصدر فاتورة التجديد في ذلك اليوم ونخصم ${renewalAmount ? formatMoney(renewalAmount) : 'قيمتها'} تلقائيًا من ${cardText(autoRenewCard, 'ar')}. لإيقاف التجديد التلقائي أو تغيير البطاقة افتح صفحة الاشتراك.`
        : autoRenewBlocked
          ? `يتجدد اشتراكك في ${payload.renewal_on} (المتبقي ${daysText(daysLeft, 'ar')}). لن نخصم التجديد تلقائيًا لأن ${SKIP_WORDS[autoRenewBlocked].ar}، فعليك دفع فاتورة التجديد بنفسك من صفحة الاشتراك بعد صدورها في ذلك اليوم.`
          : `يتجدد اشتراكك في ${payload.renewal_on} (المتبقي ${daysText(daysLeft, 'ar')}). التجديد التلقائي غير مفعّل، فعليك دفع فاتورة التجديد بنفسك من صفحة الاشتراك بعد صدورها في ذلك اليوم.`,
      en: autoRenewCard
        ? `Your subscription renews on ${payload.renewal_on} (${daysText(daysLeft, 'en')} left). The renewal invoice is issued that day and ${renewalAmount ? formatMoney(renewalAmount) : 'its total'} is charged automatically to ${cardText(autoRenewCard, 'en')}. To turn automatic renewal off or change the card, open Subscription.`
        : autoRenewBlocked
          ? `Your subscription renews on ${payload.renewal_on} (${daysText(daysLeft, 'en')} left). We will not charge the renewal automatically because ${SKIP_WORDS[autoRenewBlocked].en}, so you pay the renewal invoice yourself from Subscription once it is issued that day.`
          : `Your subscription renews on ${payload.renewal_on} (${daysText(daysLeft, 'en')} left). Automatic renewal is off, so you pay the renewal invoice yourself from Subscription once it is issued that day.` },
    card_charge_skipped: { subject: 'ادفع فاتورة اشتراكك في LiwanOS بنفسك',
      ar: `لن نخصم فاتورة التجديد من بطاقتك تلقائيًا لأن ${SKIP_WORDS[payload.skip_reason ?? 'card_unusable'].ar}. ادفعها بنفسك ببطاقة أو بتحويل بنكي من صفحة الاشتراك.`,
      en: `We will not charge the renewal invoice to your card automatically because ${SKIP_WORDS[payload.skip_reason ?? 'card_unusable'].en}. Pay it yourself with a card or a bank transfer from Subscription.` },
    card_charge_failed: { subject: 'تعذّر خصم تجديد اشتراكك في LiwanOS',
      ar: `لم ننجح في خصم فاتورة التجديد${card ? ` من ${cardText(card, 'ar')}` : ''}. ${retryOn ? `سنعيد المحاولة تلقائيًا في ${retryOn}.` : 'لن نعيد المحاولة تلقائيًا.'} يمكنك دفع الفاتورة الآن ببطاقة أخرى أو بتحويل بنكي من صفحة الاشتراك.`,
      en: `We could not charge the renewal invoice${card ? ` to ${cardText(card, 'en')}` : ''}. ${retryOn ? `We try again automatically on ${retryOn}.` : 'We will not try again automatically.'} You can pay it now with another card or a bank transfer from Subscription.` },
    card_expiring: { subject: 'بطاقتك المحفوظة في LiwanOS ستنتهي قريبًا',
      ar: `${card ? cardText(card, 'ar') : 'بطاقتك المحفوظة'} صالحة حتى ${payload.expires_on} (المتبقي ${daysText(daysLeft, 'ar')}). بعد ذلك لا يمكن خصم التجديد منها تلقائيًا. ادفع فاتورة ببطاقة جديدة من صفحة الاشتراك لحفظها بدلها.`,
      en: `${card ? cardText(card, 'en') : 'Your saved card'} is valid until ${payload.expires_on} (${daysText(daysLeft, 'en')} left). After that it cannot be charged for renewal automatically. Pay an invoice with a new card from Subscription to save it in its place.` },
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

type Context = { customer_id: string; admin_login: string | null; state: string; manual_suspension: boolean; renewal_on: string | null; grace_ends_at: Date | null
  pricing: any; auto_suspend: boolean; grace_days: number; plan_allows: boolean; locked: boolean; invoice_status: string | null; invoice_issued_at: Date | null; invoice_due_at: Date | null
  saved_attempts: number; auto_renew: boolean; renewal_amount: Money | null
  card_id: string | null; card_provider: string | null; card_mode: string | null; card_brand: string | null; card_last_four: string | null; card_exp_month: number | null; card_exp_year: number | null }

async function contextOf(pool: Pool, payload: Payload): Promise<Context | undefined> {
  return (await pool.query(`SELECT c.id AS customer_id,c.admin_login,s.state,s.manual_suspension,s.renewal_at::text AS renewal_on,s.grace_ends_at,sr.snapshot->'pricing' AS pricing,
      COALESCE(p.auto_suspend,false) AS auto_suspend,COALESCE(p.grace_days,0) AS grace_days,COALESCE(p.auto_renew_allowed,false) AS plan_allows,${holdsFreeBaseLockSql('s')} AS locked,
      (SELECT i.status FROM invoices i WHERE i.id=$2::uuid) AS invoice_status,(SELECT i.created_at FROM invoices i WHERE i.id=$2::uuid) AS invoice_issued_at,
      (SELECT i.due_at FROM invoices i WHERE i.id=$2::uuid) AS invoice_due_at,
      (SELECT count(*)::int FROM payment_attempts a JOIN invoices i ON i.order_id=a.order_id WHERE i.id=$2::uuid AND a.kind='saved_card') AS saved_attempts,s.auto_renew_enabled AS auto_renew,
      (SELECT q.payload->'next_renewal' FROM commercial_quotes q WHERE q.id::text=sr.snapshot->>'quote_id') AS renewal_amount,
      m.id AS card_id,m.provider AS card_provider,m.mode AS card_mode,m.brand AS card_brand,m.last_four AS card_last_four,m.exp_month AS card_exp_month,m.exp_year AS card_exp_year
    FROM subscriptions s JOIN customers c ON c.id=s.customer_id LEFT JOIN subscription_revisions sr ON sr.id=s.applied_revision_id
    LEFT JOIN plan_revisions p ON p.id=(sr.snapshot->>'plan_revision_id')::uuid
    LEFT JOIN payment_methods m ON m.customer_id=s.customer_id AND m.is_default AND m.status='active' WHERE s.id=$1`, [payload.subscription_id, payload.invoice_id ?? null])).rows[0]
}

/** Where automatic charges go now, when the caller knows (the payment adapter's provider and mode). Without it a card is judged usable as saved. */
export type ChargeTarget = { provider: string; mode: string }
const cardUsableAt = (ctx: Context, day: string, target?: ChargeTarget): boolean =>
  !!ctx.card_id && !!ctx.card_exp_month && !!ctx.card_exp_year && !cardExpired({ exp_month: ctx.card_exp_month, exp_year: ctx.card_exp_year }, new Date(`${day}T00:00:00+03:00`))
  && (!target || (ctx.card_provider === target.provider && ctx.card_mode === target.mode))

/** Why an automatic charge on `day` of `amount` cannot be made, or null when it can. */
function chargeBlock(ctx: Context, day: string, amount: Money | null, target?: ChargeTarget): SkipReason | null {
  if (!ctx.plan_allows) return 'plan_not_allowed'
  if (amount && amount.minor < MIN_CHARGE_MINOR) return 'amount_below_minimum'
  return cardUsableAt(ctx, day, target) ? null : 'card_unusable'
}

/**
 * The next automatic try of a declined invoice, worked out from the live rows when the notice is sent: only while automatic renewal is
 * on, a card can still be charged on that day, the decline was not a hard one, and the try comes before dunning would suspend the subscription.
 */
function nextTryOn(payload: Payload, ctx: Context, today: string, target?: ChargeTarget): string | null {
  if (payload.decline === 'hard' || !ctx.auto_renew || !ctx.invoice_issued_at || ctx.invoice_status !== 'issued') return null
  const planned = chargeDueOn(riyadhDate(ctx.invoice_issued_at), ctx.saved_attempts)
  if (!planned) return null
  const day = planned < today ? today : planned
  if (chargeBlock(ctx, day, null, target)) return null
  if (ctx.auto_suspend && ctx.invoice_due_at && day >= riyadhDate(new Date(new Date(ctx.invoice_due_at).getTime() + ctx.grace_days * 86_400_000))) return null
  return day
}

/** The default saved card as a notice may name it, or null when there is none. */
const noticeCard = (ctx: Context): NoticeCard | null => ctx.card_id && ctx.card_brand && ctx.card_last_four ? { brand: ctx.card_brand, last_four: ctx.card_last_four } : null
/** The card an automatic renewal on `renewalOn` would charge: automatic renewal on and a default card that is still valid that day. */
const autoRenewCard = (ctx: Context, renewalOn: string | null, target?: ChargeTarget): NoticeCard | null =>
  ctx.auto_renew && renewalOn && !chargeBlock(ctx, renewalOn, ctx.renewal_amount, target) ? noticeCard(ctx) : null

/** Whether the notice is still true now, judged on the live rows rather than on the moment it was queued. */
function stillTrue(payload: Payload, ctx: Context, today: string): boolean {
  switch (payload.type) {
    case 'card_charge_failed': case 'card_charge_skipped': return ['active', 'past_due'].includes(ctx.state) && !ctx.manual_suspension && ctx.invoice_status === 'issued'
    case 'card_expiring': return ctx.state !== 'cancelled' && ctx.auto_renew && ctx.card_id === payload.payment_method_id && daysBetween(today, payload.expires_on!) >= 0
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
export async function sendBillingNotices(pool: Pool, input: { now: Date; mail: MailAdapter; returnOrigin?: ReturnOrigin; chargeTarget?: ChargeTarget; signal?: AbortSignal }): Promise<number> {
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
      const anchor = row.payload.renewal_on ?? row.payload.grace_ends_on ?? row.payload.expires_on
      const notice = billingNotice(row.payload, anchor ? daysBetween(today, anchor) : 0, { autoSuspend: ctx.auto_suspend, origin: await workspaceOrigin(input.returnOrigin, ctx.customer_id),
        autoRenewCard: autoRenewCard(ctx, row.payload.renewal_on ?? null, input.chargeTarget), card: noticeCard(ctx), renewalAmount: ctx.renewal_amount,
        retryOn: row.payload.type === 'card_charge_failed' ? nextTryOn(row.payload, ctx, today, input.chargeTarget) : null,
        autoRenewBlocked: row.payload.type === 'renewal_upcoming' && ctx.auto_renew && row.payload.renewal_on ? chargeBlock(ctx, row.payload.renewal_on, ctx.renewal_amount, input.chargeTarget) : null })
      await input.mail.send({ to: ctx.admin_login, subject: notice.subject, text: notice.text, message_id: `billing-${row.id}@liwan` })
      await completeOutbox(pool, row.id)
      sent++
    } catch (error) { await deferOutbox(pool, row.id, error instanceof Error ? error.message.slice(0, 200) : 'billing_notice_failed') }
  }
  return sent
}
