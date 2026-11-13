import { createHash, randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import type { AttentionItem, AttentionKind } from '@liwan/commercial-contracts'
import { allAttentionItems } from './attention.js'
import type { MailAdapter } from './mail-adapter.js'
import type { TelegramSender } from './telegram-adapter.js'
import { completeOutbox, deferOutbox, failOutbox, leaseOutboxRow, releaseOutbox } from './outbox.js'

export const VENDOR_ALERT_KIND = 'vendor.alert'
/** More alerts than this for one kind of event inside the window collapse into one summary line. */
export const ALERT_BURST_LIMIT = 5
export const ALERT_BURST_WINDOW_HOURS = 1
/** A fact older than this when the scan first sees it (a worker that was down for days, a fresh install) is not announced. */
export const ALERT_LOOKBACK_HOURS = 72
/** The first workspace is late for the owner after this long; the customer is told earlier (workspace-delay-notice.ts). */
export const WORKSPACE_LATE_MINUTES = 30
/** With the outbox backoff (1, 2, 4 ... 60 minutes) this is about eleven hours of retries before a channel gives up. */
export const ALERT_MAX_ATTEMPTS = 12
const NAME_MAX = 80
const DETAIL_MAX = 120
const SUBJECT_MAX = 150
const TEXT_MAX = 1200
const DELIVERY_BATCH = 50

type Env = Record<string, string | undefined>
type Money = { minor: number; currency: string; exponent: number }
type Need = 'none' | 'maybe' | 'yes'

const EVENTS = {
  signup: { title: 'عميل جديد أكمل التسجيل', plural: 'عملاء جدد', need: 'none', collapsible: true, todo: 'لا إجراء مطلوب.' },
  workspace_late: { title: 'مساحة العميل لم تُسلَّم بعد 30 دقيقة', plural: 'مساحات متأخرة', need: 'maybe', collapsible: false, todo: 'إن لم تُسلَّم خلال دقائق فافتح صفحة العميل وراجع حالة التجهيز.' },
  bank_transfer_claimed: { title: 'عميل أبلغ عن تحويل بنكي بانتظار تأكيدك', plural: 'تحويلات بانتظار التأكيد', need: 'yes', collapsible: false, todo: 'تحقق من وصول المبلغ إلى حسابك ثم أكّد التحويل من صفحة العميل.' },
  payment_received: { title: 'دفعة مستلمة', plural: 'دفعات مستلمة', need: 'none', collapsible: true, todo: 'لا إجراء مطلوب.' },
  payment_overdue: { title: 'فاتورة اشتراك لم تُسدَّد', plural: 'فواتير لم تُسدَّد', need: 'none', collapsible: true, todo: 'لا إجراء الآن، أُبلغ العميل.' },
  subscription_suspended: { title: 'عُلِّق اشتراك لعدم السداد', plural: 'اشتراكات عُلِّقت لعدم السداد', need: 'none', collapsible: true, todo: 'لا إجراء مطلوب.' },
  cancel_requested: { title: 'عميل ألغى تجديد اشتراكه', plural: 'إلغاءات تجديد', need: 'none', collapsible: true, todo: 'لا إجراء مطلوب.' },
  cancel_withdrawn: { title: 'عميل تراجع عن إلغاء اشتراكه', plural: 'تراجعات عن الإلغاء', need: 'none', collapsible: true, todo: 'لا إجراء مطلوب.' },
  refund_requested: { title: 'طُلب استرداد لعميل', plural: 'طلبات استرداد', need: 'none', collapsible: true, todo: 'لا إجراء مطلوب.' },
  refund_completed: { title: 'اكتمل استرداد لعميل', plural: 'استردادات مكتملة', need: 'none', collapsible: true, todo: 'لا إجراء مطلوب.' },
  refund_rejected: { title: 'فشل استرداد لعميل', plural: 'استردادات فاشلة', need: 'yes', collapsible: false, todo: 'افتح صفحة العميل وراجع السبب قبل أي محاولة ثانية.' },
  refund_unrecorded: { title: 'استرداد عالق دون تسجيل', plural: 'استردادات عالقة', need: 'yes', collapsible: false, todo: 'قد يكون المبلغ ردّ للعميل فلا تُعد الاسترداد. راجع سبب تعذّر التسجيل.' },
  trial_converted: { title: 'انتهت تجربة وتحوّلت إلى اشتراك مدفوع', plural: 'تجارب تحوّلت إلى مدفوعة', need: 'none', collapsible: true, todo: 'لا إجراء مطلوب.' },
  trial_free_base: { title: 'انتهت تجربة ورجع العميل إلى الباقة المجانية', plural: 'تجارب رجعت إلى الباقة المجانية', need: 'none', collapsible: true, todo: 'لا إجراء مطلوب.' },
  attention: { title: 'يحتاج انتباهك', plural: 'بنود تحتاج انتباهك', need: 'yes', collapsible: true, todo: 'افتح قائمة الانتباه في لوحة التحكم.' },
} as const satisfies Record<string, { title: string; plural: string; need: Need; collapsible: boolean; todo: string }>
export type AlertEvent = keyof typeof EVENTS

/** Attention kinds with no alert of their own here: `past_due` is the overdue-invoice alert, `renewal_soon` needs nothing from the owner. */
const ATTENTION_ALERT_EVENT: Partial<Record<AttentionKind, AlertEvent>> = { bank_transfer_claimed: 'bank_transfer_claimed', refund_rejected: 'refund_rejected', refund_unrecorded: 'refund_unrecorded' }
const ATTENTION_SKIPPED: readonly AttentionKind[] = ['past_due', 'renewal_soon']
const ATTENTION_LABELS: Record<Exclude<AttentionKind, 'bank_transfer_claimed' | 'refund_rejected' | 'refund_unrecorded' | 'past_due' | 'renewal_soon'>, string> = {
  billing_blocked: 'الفوترة موقوفة لهذا العميل',
  free_base_blocked: 'تعذّر رجوع العميل إلى الباقة المجانية',
  renewal_failed: 'فشل تجديد الاشتراك',
  trial_end_overdue: 'تجربة انتهت ولم تُغلق',
  suspension_undelivered: 'التعليق لم يصل إلى مساحة العميل',
  stalled_activation: 'تفعيل الاشتراك متعثر',
  invitation_failed: 'تعذّر إرسال دعوة المدير',
  notice_failed: 'تعذّر إرسال إشعار للعميل',
  operation_failed: 'عملية تشغيل فاشلة',
  setup_required: 'الإعداد التجاري لم يكتمل',
  renewal_missed: 'تجديد فات موعده',
}

const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g

/** Text from a customer or a provider is data: control and bidi characters go, whitespace collapses, the length is capped. */
export function cleanAlertText(value: unknown, max: number): string {
  const text = String(value ?? '').replace(UNSAFE_TEXT, ' ').replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

const formatMoney = (m: Money) => `${(m.minor / 10 ** m.exponent).toFixed(m.exponent)} ${cleanAlertText(m.currency, 3)}`

type Candidate = { key: string; event: AlertEvent; customerId: string | null; name: string; lines: string[]; title?: string; amount?: Money }

const NEED_TAG: Record<Need, string> = { none: '[للعلم]', maybe: '[قد يتطلب إجراء]', yes: '[يتطلب إجراء]' }

const consoleLink = (origin: string | undefined, customerId: string | null) => origin ? `${origin.replace(/\/+$/, '')}${customerId ? `/customers/${customerId}` : '/overview'}` : null

function render(event: AlertEvent, title: string, lines: string[], todo: string, link: string | null): { subject: string; text: string } {
  const subject = cleanAlertText(`${NEED_TAG[EVENTS[event].need]} ${title}`, SUBJECT_MAX)
  return { subject, text: [subject, ...lines, todo, ...(link ? [`الرابط: ${link}`] : [])].join('\n').slice(0, TEXT_MAX) }
}

function messageOf(c: Candidate, origin: string | undefined) {
  const spec = EVENTS[c.event]
  const lines = [`العميل: ${cleanAlertText(c.name, NAME_MAX) || 'غير مسمّى'}`, ...(c.amount ? [`المبلغ: ${formatMoney(c.amount)}`] : []), ...c.lines]
  return render(c.event, c.title ?? spec.title, lines, spec.todo, consoleLink(origin, c.customerId))
}

function summaryOf(event: AlertEvent, count: number, origin: string | undefined) {
  const spec = EVENTS[event]
  return render(event, `${spec.plural}: ${count}`, [`وقع ${count} من هذا النوع في وقت قصير فجُمعت في رسالة واحدة.`], spec.todo, consoleLink(origin, null))
}

const money = (row: { total_minor?: unknown; currency?: unknown; exponent?: unknown }): Money | undefined =>
  row.total_minor != null && row.currency ? { minor: Number(row.total_minor), currency: String(row.currency), exponent: Number(row.exponent) } : undefined

const attentionKey = (i: AttentionItem) => ['attention', i.kind, i.customer_id ?? i.tenant_id ?? i.operation_id ?? i.name, i.operation_id ?? '', i.invoice_id ?? '', i.since].join(':')

/** The attention list is the source for what only the owner can fix; an item alerts when it first appears and not again while it stays (`since` is part of the key). */
async function attentionCandidates(pool: Pool): Promise<Candidate[]> {
  const items = (await allAttentionItems(pool)).filter(i => !ATTENTION_SKIPPED.includes(i.kind))
  const invoiceIds = [...new Set(items.map(i => i.invoice_id).filter((id): id is string => !!id))]
  const invoices = new Map<string, Record<string, unknown>>()
  if (invoiceIds.length) for (const row of (await pool.query(`SELECT i.id,i.total_minor,i.currency,i.exponent,k.sender_reference FROM invoices i
    LEFT JOIN bank_transfer_claims k ON k.invoice_id=i.id WHERE i.id=ANY($1::uuid[])`, [invoiceIds])).rows) invoices.set(row.id, row)
  return items.map((item): Candidate => {
    const invoice = item.invoice_id ? invoices.get(item.invoice_id) : undefined
    const event = ATTENTION_ALERT_EVENT[item.kind] ?? 'attention'
    const detail = cleanAlertText(item.detail, DETAIL_MAX)
    const lines: string[] = []
    if (item.kind === 'bank_transfer_claimed') {
      if (detail) lines.push(`تاريخ التحويل المذكور: ${detail}`)
      const reference = cleanAlertText(invoice?.sender_reference, DETAIL_MAX)
      if (reference) lines.push(`مرجع المرسل المذكور: ${reference}`)
    } else if (detail) lines.push(`السبب: ${detail}`)
    const label = event === 'attention' ? ATTENTION_LABELS[item.kind as keyof typeof ATTENTION_LABELS] : undefined
    return { key: attentionKey(item), event, customerId: item.customer_id, name: item.name, lines, amount: invoice ? money(invoice) : undefined,
      ...(label ? { title: `${EVENTS.attention.title}: ${label}` } : {}) }
  })
}

/** Facts that already sit in a durable row: a sign-up's customer, a billing notice queued with the state change, an audit event, a credit note, a trial outcome. */
async function factCandidates(pool: Pool, since: Date, now: Date): Promise<Candidate[]> {
  const out: Candidate[] = []
  const add = (key: string, event: AlertEvent, row: { customer_id: string; name: string }, extra: Partial<Candidate> = {}) =>
    out.push({ key, event, customerId: row.customer_id, name: row.name, lines: [], ...extra })

  for (const row of (await pool.query(`SELECT c.id AS customer_id,c.name FROM public_signup_trials t JOIN customers c ON c.id=t.customer_id WHERE c.created_at >= $1`, [since])).rows)
    add(`signup:${row.customer_id}`, 'signup', row, { lines: ['أكمل التحقق من الجوال والبريد وبدأت تجربته.'] })

  for (const row of (await pool.query(`SELECT c.id AS customer_id,c.name FROM orders o JOIN subscriptions s ON s.id=o.subscription_id JOIN customers c ON c.id=o.customer_id
    WHERE o.kind='new' AND o.payment_state='not_required' AND NOT o.cancelled AND s.applied_revision_id IS NULL
      AND o.created_at >= $1 AND o.created_at <= $2::timestamptz - make_interval(mins => $3::int)`, [since, now, WORKSPACE_LATE_MINUTES])).rows)
    add(`workspace-late:${row.customer_id}`, 'workspace_late', row, { lines: ['لم تُسلَّم مساحة العمل الأولى بعد.'] })

  // The billing notice is queued in the transaction that changes the state, so its row is the one durable record of these three facts.
  const noticeEvent = { payment_received: 'payment_received', overdue: 'payment_overdue', suspended: 'subscription_suspended' } as const
  for (const row of (await pool.query(`SELECT ob.id,ob.payload->>'type' AS type,ob.payload->'amount' AS amount,c.id AS customer_id,c.name,i.total_minor,i.currency,i.exponent
    FROM commercial_outbox ob JOIN subscriptions s ON s.id::text=ob.aggregate_id JOIN customers c ON c.id=s.customer_id
    LEFT JOIN invoices i ON i.id::text=ob.payload->>'invoice_id'
    WHERE ob.kind='billing.notice' AND ob.payload->>'type' IN ('payment_received','overdue','suspended') AND ob.created_at >= $1`, [since])).rows)
    add(`notice:${row.id}`, noticeEvent[row.type as keyof typeof noticeEvent], row, { amount: row.amount ?? money(row) })

  for (const row of (await pool.query(`SELECT a.id,a.action,a.metadata->>'effective_on' AS effective_on,c.id AS customer_id,c.name FROM audit_events a
    JOIN subscriptions s ON s.id::text=a.subject JOIN customers c ON c.id=s.customer_id
    WHERE a.action IN ('subscription.cancel_requested','subscription.cancel_withdrawn') AND a.created_at >= $1`, [since])).rows) {
    const cancelled = row.action === 'subscription.cancel_requested'
    add(`audit:${row.id}`, cancelled ? 'cancel_requested' : 'cancel_withdrawn', row,
      { lines: cancelled && row.effective_on ? [`ينتهي الاشتراك في ${cleanAlertText(row.effective_on, 10)} ويرجع إلى الباقة المجانية.`] : [] })
  }

  const notes = `SELECT n.id,n.amount_minor AS total_minor,n.currency,n.exponent,c.id AS customer_id,c.name FROM invoice_adjustments n JOIN customers c ON c.id=n.customer_id
    WHERE n.origin='vendor' AND n.cause='vendor_refund'`
  for (const row of (await pool.query(`${notes} AND n.created_at >= $1`, [since])).rows) add(`refund-requested:${row.id}`, 'refund_requested', row, { amount: money(row) })
  for (const row of (await pool.query(`${notes} AND n.status='refunded' AND n.refunded_at >= $1`, [since])).rows) add(`refund-completed:${row.id}`, 'refund_completed', row, { amount: money(row) })

  for (const row of (await pool.query(`SELECT s.id,s.trial_outcome,s.trial_ended_at,c.id AS customer_id,c.name FROM subscriptions s JOIN customers c ON c.id=s.customer_id
    WHERE s.trial_outcome IS NOT NULL AND s.trial_ended_at >= $1`, [since])).rows) {
    const free = row.trial_outcome === 'free_base'
    add(`trial-end:${row.id}:${new Date(row.trial_ended_at).getTime()}`, free ? 'trial_free_base' : 'trial_converted', row,
      { lines: row.trial_outcome === 'kept_subset' ? ['أبقى جزءًا من الباقة ورجع الباقي إلى الباقة المجانية.'] : [] })
  }
  return out
}

/** Which channels can deliver now, and why the others cannot. The off switch is `off`, `0`, `false` or `no`. */
export function alertChannels(env: Env, deps: { mail?: MailAdapter; telegram?: TelegramSender }) {
  const off = (v: string | undefined) => /^(off|0|false|no)$/i.test((v ?? '').trim())
  const to = (env.LIWAN_VENDOR_ALERT_EMAIL_TO ?? '').trim()
  const notes: string[] = []
  let email: { to: string; mail: MailAdapter } | null = null
  if (off(env.LIWAN_VENDOR_ALERT_EMAIL)) notes.push('email switched off')
  else if (!to) notes.push('email has no recipient (LIWAN_VENDOR_ALERT_EMAIL_TO)')
  else if (!/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(to)) notes.push('email recipient is not a single address')
  else if (!deps.mail) notes.push('email has no mail adapter')
  else email = { to, mail: deps.mail }
  let telegram: TelegramSender | null = null
  if (off(env.LIWAN_VENDOR_ALERT_TELEGRAM)) notes.push('telegram switched off')
  else if (!deps.telegram) notes.push('telegram is not configured')
  else telegram = deps.telegram
  return { email, telegram, notes }
}

type Row = { key: string; aggregate: string; payload: Record<string, unknown>; done?: boolean }

async function insertRows(pool: Pool, rows: Row[]) {
  for (const row of rows) await pool.query(`INSERT INTO commercial_outbox(id,kind,aggregate_id,dedupe_key,payload,status,processed_at) VALUES($1,$2,$3,$4,$5::jsonb,$6,CASE WHEN $6='done' THEN now() END)
    ON CONFLICT DO NOTHING`, [randomUUID(), VENDOR_ALERT_KIND, row.aggregate, row.key, JSON.stringify(row.payload), row.done ? 'done' : 'pending'])
}

/**
 * Queues one alert per new fact. A burst collapses: when an event kind already has ALERT_BURST_LIMIT alerts in the last
 * ALERT_BURST_WINDOW_HOURS hours, further facts of that kind are recorded as held (never alerted twice) and announced by one
 * summary line, at most one per kind per window. Kinds that need the owner (a bank transfer, a failed refund) never collapse.
 */
async function queueAlerts(pool: Pool, found: Candidate[], origin: string | undefined) {
  const unique = [...new Map(found.map(c => [c.key, c])).values()]
  const known = new Set((await pool.query('SELECT dedupe_key FROM commercial_outbox WHERE kind=$1 AND dedupe_key=ANY($2::text[])', [VENDOR_ALERT_KIND, unique.map(c => c.key)])).rows.map(r => r.dedupe_key))
  const fresh = unique.filter(c => !known.has(c.key))
  const window = `now() - make_interval(hours => ${ALERT_BURST_WINDOW_HOURS})`
  const recent = new Map((await pool.query(`SELECT payload->>'event' AS event,count(*) FILTER (WHERE payload->>'summary' IS NULL)::int AS alerts,
      count(*) FILTER (WHERE payload->>'summary'='true')::int AS summaries FROM commercial_outbox WHERE kind=$1 AND created_at >= ${window} GROUP BY 1`, [VENDOR_ALERT_KIND]))
    .rows.map(r => [r.event as string, r as { alerts: number; summaries: number }]))
  const held = (await pool.query(`SELECT id,payload->>'event' AS event FROM commercial_outbox WHERE kind=$1 AND payload->>'held'='true'`, [VENDOR_ALERT_KIND])).rows as { id: string; event: AlertEvent }[]
  const events = new Set<AlertEvent>([...fresh.map(c => c.event), ...held.map(h => h.event)])
  const rows: Row[] = []
  for (const event of events) {
    const spec = EVENTS[event]
    const mine = fresh.filter(c => c.event === event)
    const heldBefore = held.filter(h => h.event === event)
    const state = recent.get(event) ?? { alerts: 0, summaries: 0 }
    const over = spec.collapsible && mine.length > 0 && state.alerts + mine.length > ALERT_BURST_LIMIT
    const individual = over ? [] : mine
    const collapsed = over ? mine : []
    for (const c of individual) rows.push({ key: c.key, aggregate: c.customerId ?? 'vendor', payload: { event, customer_id: c.customerId, ...messageOf(c, origin) } })
    const summaryDue = spec.collapsible && state.summaries === 0 && collapsed.length + heldBefore.length > 0
    if (summaryDue) {
      const count = collapsed.length + heldBefore.length
      const digest = createHash('sha256').update([...collapsed.map(c => c.key), ...heldBefore.map(h => h.id)].sort().join('|')).digest('hex').slice(0, 24)
      rows.push({ key: `summary:${event}:${digest}`, aggregate: 'vendor', payload: { event, summary: true, count, ...summaryOf(event, count, origin) } })
      if (heldBefore.length) await pool.query(`UPDATE commercial_outbox SET payload=(payload-'held')||'{"summarized":true}'::jsonb WHERE id=ANY($1::uuid[])`, [heldBefore.map(h => h.id)])
    }
    for (const c of collapsed) rows.push({ key: c.key, aggregate: c.customerId ?? 'vendor', done: true,
      payload: { event, customer_id: c.customerId, ...(summaryDue ? { summarized: true } : { held: true }), text: messageOf(c, origin).text } })
  }
  await insertRows(pool, rows)
  return rows.filter(r => !r.done).length
}

type Pending = { id: string; attempts: number; payload: { subject?: string; text?: string; sent_email?: boolean; sent_telegram?: boolean } }

async function markSent(pool: Pool, id: string, channel: 'email' | 'telegram') {
  await pool.query(`UPDATE commercial_outbox SET payload=payload||jsonb_build_object($2::text,true) WHERE id=$1`, [id, `sent_${channel}`])
}

const reason = (error: unknown) => cleanAlertText(error instanceof Error ? (error as { code?: string }).code ?? error.message : 'error', 120)

/** Each configured channel is tried on its own; a channel that already took the message is never sent it again, and one failing never stops the other. */
async function deliver(pool: Pool, input: { env: Env; mail?: MailAdapter; telegram?: TelegramSender; signal?: AbortSignal; log: (m: string, e?: unknown) => void }) {
  const channels = alertChannels(input.env, input)
  const rows = (await pool.query(`SELECT id,attempts,payload FROM commercial_outbox WHERE kind=$1 AND status='pending' AND next_attempt_at <= now() ORDER BY created_at,id LIMIT ${DELIVERY_BATCH}`, [VENDOR_ALERT_KIND])).rows as Pending[]
  let sent = 0
  for (const row of rows) {
    if (input.signal?.aborted) return sent
    const lease = await leaseOutboxRow(pool, row.id)
    if (!lease) continue
    if (!channels.email && !channels.telegram) {
      await pool.query(`UPDATE commercial_outbox SET payload=payload||'{"skipped":"no_channel_configured"}'::jsonb WHERE id=$1`, [row.id])
      await completeOutbox(pool, row.id)
      try { input.log(`vendor alert ${row.id} completed without sending: no alert channel is configured (${channels.notes.join('; ')})`) } catch { /* never throw */ }
      continue
    }
    if (input.signal?.aborted) { await releaseOutbox(pool, row.id, lease); return sent }
    const failures: string[] = []
    const subject = cleanAlertText(row.payload.subject, SUBJECT_MAX)
    const text = String(row.payload.text ?? '').slice(0, TEXT_MAX)
    if (channels.email && !row.payload.sent_email) {
      try { await channels.email.mail.send({ to: channels.email.to, subject, text, message_id: `vendor-alert-${row.id}@liwan` }); await markSent(pool, row.id, 'email') }
      catch (error) { failures.push(`email: ${reason(error)}`) }
    }
    if (channels.telegram && !row.payload.sent_telegram) {
      try { await channels.telegram.send(text); await markSent(pool, row.id, 'telegram') }
      catch (error) { failures.push(`telegram: ${reason(error)}`) }
    }
    if (!failures.length) { await completeOutbox(pool, row.id); sent++; continue }
    const message = failures.join('; ')
    if (row.attempts + 1 >= ALERT_MAX_ATTEMPTS) { await failOutbox(pool, row.id, message); try { input.log(`vendor alert ${row.id} gave up: ${message}`) } catch { /* never throw */ } }
    else await deferOutbox(pool, row.id, message)
  }
  return sent
}

export type VendorAlertInput = {
  now: Date; env: Env; mail?: MailAdapter; telegram?: TelegramSender
  /** The vendor console origin (ADMIN_ORIGIN); without it the messages carry no link. */
  consoleOrigin?: string
  signal?: AbortSignal; log?: (message: string, error?: unknown) => void
}

/**
 * Scans the durable facts for what the owner should hear about, queues one alert per fact (the key names the fact, so a
 * re-run or a restart never queues it twice) and delivers every due alert by email and Telegram. Returns the number delivered.
 */
export async function sendVendorAlerts(pool: Pool, input: VendorAlertInput): Promise<number> {
  const log = input.log ?? ((m: string, e?: unknown) => console.error(`[vendor-alerts] ${m}`, e instanceof Error ? e.message : e ?? ''))
  if (input.signal?.aborted) return 0
  const since = new Date(input.now.getTime() - ALERT_LOOKBACK_HOURS * 3_600_000)
  try {
    const found = [...await factCandidates(pool, since, input.now), ...await attentionCandidates(pool)]
    await queueAlerts(pool, found, input.consoleOrigin)
  } catch (error) { try { log('vendor alert scan failed; pending alerts are still delivered', error) } catch { /* never throw */ } }
  return deliver(pool, { env: input.env, mail: input.mail, telegram: input.telegram, signal: input.signal, log })
}
