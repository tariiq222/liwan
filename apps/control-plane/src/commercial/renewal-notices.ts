import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { addCadence, daysBetween, riyadhDate, type Cadence, type Money } from '@liwan/commercial-contracts'
import { transaction } from '../db.js'
import { holdsTrialAfterLapseSql, owesAtRenewalSql } from './free-base.js'
import { formatNoticeMoney } from './notice-money.js'
import type { MailAdapter } from './mail-adapter.js'
import { RENEWAL_NOTICE_LEAD_DAYS, RENEWAL_NOTICE_MIN_DAYS } from './notice-timings.js'
import type { PaymentAdapter } from './payment-adapter.js'
import { quoteRenewal } from './renewal-quote.js'

const LEASE_MS = 5 * 60_000
const RETRY_MS = 60 * 60_000

/** Both reservation and dispatch require the same receipt after current consent. */
export const timelyRenewalNoticeSql = `n.state='sent' AND n.sent_at>=m.consent_at
  AND (n.sent_at AT TIME ZONE 'Asia/Riyadh')::date <= n.renewal_date - ${RENEWAL_NOTICE_MIN_DAYS}`

/** A first post-trial invoice is always manual, including a same-day reopened trial. */
export const firstLapseRenewalSql = (sub: string, start: string) => `EXISTS (
  SELECT 1 FROM trial_lapses tl WHERE tl.subscription_id=${sub}.id AND tl.state='done' AND tl.period_start=${start})`

const eligible = `s.state='active' AND NOT s.manual_suspension AND s.target_revision_id IS NULL
  AND s.trial_ends_at IS NULL AND NOT ${holdsTrialAfterLapseSql('s')}
  AND NOT ${firstLapseRenewalSql('s', 's.renewal_at')}
  AND s.renewal_at BETWEEN $1::date + $2::int AND $1::date + $3::int
  AND m.state='active' AND m.provider=$4
  AND ${owesAtRenewalSql("sr.snapshot->'pricing'")}`
const candidates = `FROM subscriptions s JOIN subscription_revisions sr ON sr.id=s.applied_revision_id
  JOIN payment_methods m ON m.subscription_id=s.id JOIN customers c ON c.id=s.customer_id`

type ClaimedNotice = {
  id: string; login: string; date: string; amount: Money; lease: Date
}

async function claimNotice(pool: Pool, subscriptionId: string, provider: string, clock: () => number): Promise<ClaimedNotice | null> {
  return transaction(pool, async client => {
    const now = new Date(clock()), today = riyadhDate(now)
    const sub = (await client.query(`SELECT s.*,s.renewal_at::text,sr.snapshot,m.id AS method_id,m.consent_at,c.admin_login ${candidates}
      WHERE ${eligible} AND s.id=$5 FOR SHARE OF s,m`, [
      today, RENEWAL_NOTICE_MIN_DAYS, RENEWAL_NOTICE_LEAD_DAYS, provider, subscriptionId,
    ])).rows[0]
    if (!sub?.admin_login || new Date(sub.consent_at) > now) return null
    const start = sub.renewal_at as string
    const period = { start, end: addCadence(start, sub.snapshot.cadence, 1) }
    const { quote, autoRenewAllowed } = await quoteRenewal(client, sub, sub.snapshot, period, now)
    const amount = quote.due_now
    if (!autoRenewAllowed || amount.minor === 0) return null
    const keys = [sub.method_id, start, amount.minor, amount.currency, amount.exponent, quote.cadence.unit, quote.cadence.count]
    await client.query(`UPDATE renewal_notices SET state='void',void_reason='amount_changed'
      WHERE method_id=$1 AND renewal_date=$2 AND state='due'
        AND (amount_minor,currency,exponent,cadence_unit,cadence_count) IS DISTINCT FROM
          ($3::bigint,$4::text,$5::integer,$6::text,$7::integer)`, keys)
    await client.query(`INSERT INTO renewal_notices(method_id,renewal_date,amount_minor,currency,exponent,cadence_unit,cadence_count,id,subscription_id,next_attempt_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`, [...keys, randomUUID(), sub.id, now])
    const lease = new Date(clock() + LEASE_MS)
    const row = (await client.query(`UPDATE renewal_notices SET next_attempt_at=$8
      WHERE method_id=$1 AND renewal_date=$2 AND amount_minor=$3 AND currency=$4 AND exponent=$5
        AND cadence_unit=$6 AND cadence_count=$7 AND state='due' AND next_attempt_at<=$9 RETURNING id`, [...keys, lease, now])).rows[0]
    return row ? { id: row.id, login: sub.admin_login, date: start, amount, lease } : null
  })
}

async function deliver(pool: Pool, notice: ClaimedNotice, mail: MailAdapter, clock: () => number) {
  const { amount, date, id, lease } = notice
  let accepted = false
  if (daysBetween(riyadhDate(new Date(clock())), date) >= RENEWAL_NOTICE_MIN_DAYS) {
    const money = formatNoticeMoney(amount)
    const ar = `يُستحق تجديد اشتراكك في ليوان بتاريخ ${date} بتوقيت الرياض، بمبلغ ${money}. خُصصت وسيلة الدفع المحفوظة لهذا الخصم المجدول. يمكنك إيقاف التجديد التلقائي من صفحة الاشتراك قبل موعد التجديد.`
    const en = `Your Liwan subscription renews on ${date} (Riyadh time) for ${money}. This charge is scheduled for your saved payment method. You can turn off auto-renew from Subscription before renewal.`
    try { accepted = (await mail.send({ to: notice.login, subject: 'إشعار تجديد اشتراك ليوان', text: `${ar}\n${en}`, message_id: `renewal-${id}@liwan` })).accepted === true }
    catch { /* Delivery stays due and retries at the recorded next attempt. */ }
  }
  const now = new Date(clock())
  const timely = daysBetween(riyadhDate(now), date) >= RENEWAL_NOTICE_MIN_DAYS
  const settled = await pool.query(`UPDATE renewal_notices SET
    state=CASE WHEN NOT $3 THEN 'void' WHEN $4 THEN 'sent' ELSE 'due' END,
    sent_at=CASE WHEN $3 AND $4 THEN $5::timestamptz ELSE NULL END,
    void_reason=CASE WHEN NOT $3 THEN 'late' ELSE NULL END,
    attempts=attempts+1,next_attempt_at=$6
    WHERE id=$1 AND state='due' AND next_attempt_at=$2`, [id,lease,timely,accepted,now,new Date(now.getTime()+RETRY_MS)])
  return Boolean(settled.rowCount && timely && accepted)
}

/** Uses the notice row as its durable outbox. Only accepted mail records a qualifying delivery. */
export async function sendRenewalNotices(pool: Pool, input: {
  adapter: PaymentAdapter; mail: MailAdapter; clock?: () => number; signal?: AbortSignal
}): Promise<number> {
  if (input.adapter.mode !== 'simulator' || input.signal?.aborted) return 0
  const clock = input.clock ?? Date.now
  const today = riyadhDate(new Date(clock()))
  await pool.query(`UPDATE renewal_notices n SET state='void',
    void_reason=CASE WHEN n.renewal_date < $1::date + $2::int THEN 'late' ELSE 'method_closed' END
    FROM payment_methods m WHERE m.id=n.method_id AND n.state='due'
      AND (n.renewal_date < $1::date + $2::int OR m.state<>'active')`, [today, RENEWAL_NOTICE_MIN_DAYS])
  const { rows } = await pool.query(`SELECT s.id ${candidates} WHERE ${eligible} ORDER BY s.renewal_at,s.id`, [
    today, RENEWAL_NOTICE_MIN_DAYS, RENEWAL_NOTICE_LEAD_DAYS, input.adapter.provider,
  ])
  let sent = 0
  for (const { id } of rows) {
    if (input.signal?.aborted) break
    try {
      const notice = await claimNotice(pool, id, input.adapter.provider, clock)
      if (notice && !input.signal?.aborted && await deliver(pool, notice, input.mail, clock)) sent++
    } catch (error) {
      console.error(`[renewal-notices] subscription ${id} skipped: ${error instanceof Error ? error.name : 'error'}`)
    }
  }
  return sent
}

/** Called within the renewal transaction, after the issued invoice fixes the exact money. */
export async function reserveNoticedCharge(client: PoolClient, input: {
  adapter: PaymentAdapter; subscription: string; order: string; invoice: string; date: string; amount: Money; cadence: Cadence; clock: () => number
}) {
  const { adapter, subscription, order, invoice, date, amount, cadence, clock } = input
  if (adapter.mode !== 'simulator' || amount.minor <= 0) return false
  const evidence = (await client.query(`SELECT n.id,n.method_id FROM renewal_notices n JOIN payment_methods m ON m.id=n.method_id
    WHERE m.subscription_id=$1 AND m.state='active' AND m.provider=$2 AND n.renewal_date=$3
      AND (n.amount_minor,n.currency,n.exponent)=($4::bigint,$5::text,$6::integer)
      AND n.cadence_unit=$7 AND n.cadence_count=$8 AND ${timelyRenewalNoticeSql}
    FOR SHARE OF m,n`, [subscription,adapter.provider,date,amount.minor,amount.currency,amount.exponent,cadence.unit,cadence.count])).rows[0]
  if (!evidence) return false
  const reservedAt = new Date(clock())
  if (riyadhDate(reservedAt) !== date) return false
  await client.query(`INSERT INTO payment_attempts(id,order_id,invoice_id,provider,mode,amount_minor,currency,exponent,token_charge,method_id,notice_id,created_at,updated_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,true,$9,$10,$11,$11)`, [
    randomUUID(),order,invoice,adapter.provider,adapter.mode,amount.minor,amount.currency,amount.exponent,evidence.method_id,evidence.id,reservedAt,
  ])
  return true
}
