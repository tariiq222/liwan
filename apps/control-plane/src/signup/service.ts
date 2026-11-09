import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import type { Pool, PoolClient } from 'pg'
import { transaction } from '../db.js'
import { CommercialHttpError } from '../commercial/lifecycle.js'
import { startTrialOn } from '../commercial/trial.js'

const minutes = (count: number) => count * 60_000
const maxAttempts = 5
const signupDeliveryLock = 1397969237
const ok = { ok: true } as const
type Channel = 'sms' | 'email'
type SendCode = (destination: string, code: string) => Promise<void>
type Settings = { secret: string; planId: string; dailyLimit: number; sms: SendCode; email: SendCode; now?: () => Date }
type Challenge = {
  id: string; company_name: string; admin_name: string; email: string; mobile: string;
  expires_at: Date; mobile_verified: boolean; completed: boolean;
  sms_digest: Buffer; sms_expires_at: Date; sms_attempts: number;
  email_digest: Buffer | null; email_expires_at: Date | null; email_attempts: number;
}

const mobileSchema = z.string().trim().max(30).transform(value => value.replace(/[ ()-]/g, ''))
  .pipe(z.string().regex(/^(?:\+?966|0)?5[0-9]{8}$/))
  .transform(value => `+966${value.slice(-9)}`)

const personOrCompanyName = (max: number) => z.string().trim().min(1).max(max)
  .refine(value => !Array.from(value).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127))

export const signupInput = z.strictObject({
  company_name: personOrCompanyName(200),
  admin_name: personOrCompanyName(120),
  email: z.string().trim().toLowerCase().pipe(z.email().max(100)),
  mobile: mobileSchema,
})

function refuse(code: string, status: number): never { throw new CommercialHttpError(code, status) }
const codeValue = () => String(randomInt(1_000_000)).padStart(6, '0')

export class SignupService {
  constructor(private pool: Pool, private settings: Settings) {}

  private now() { return this.settings.now?.() ?? new Date() }
  private key(...parts: string[]) { return createHmac('sha256', this.settings.secret).update(JSON.stringify(parts)).digest() }
  private digest(id: string, channel: Channel, code: string) { return this.key('otp', id, channel, code) }

  private async plan(client: Pick<Pool, 'query'>) {
    const monthlyPrice = JSON.stringify([{ cadence: { unit: 'month', count: 1 } }])
    const result = await client.query<{ included_users: number; included_storage_mb: number }>(`
      SELECT included_users,included_storage_mb FROM plan_revisions
      WHERE id=$1 AND status='published' AND available AND audience->>'kind'='public'
        AND trial_days=14 AND prices @> $2::jsonb FOR SHARE`, [this.settings.planId, monthlyPrice])
    return result.rows[0] ?? refuse('unavailable', 503)
  }

  // Hold across counts and insert so concurrent instances share the same delivery budget.
  private async lockDeliveries(client: PoolClient) {
    await client.query('SELECT pg_advisory_xact_lock($1)', [signupDeliveryLock])
  }

  private async reserveDelivery(client: PoolClient, channel: Channel, destination: string, ip: string, now: Date) {
    const address = this.key('destination', channel, destination).toString('hex')
    const subnet = await client.query<{ address: string }>(
      'SELECT network(set_masklen($1::inet, CASE family($1::inet) WHEN 6 THEN 64 ELSE 32 END))::text AS address', [ip])
    const source = this.key('source', subnet.rows[0]!.address).toString('hex')
    await client.query("DELETE FROM public_signup_deliveries WHERE issued_at <= $1::timestamptz - interval '1 day'", [now])
    const { rows: [count] } = await client.query<{ total: number; recent: number; destination: number; source: number }>(`
      SELECT count(*)::int AS total,
        count(*) FILTER (WHERE destination_key=$2 AND issued_at > $4::timestamptz - interval '1 minute')::int AS recent,
        count(*) FILTER (WHERE destination_key=$2 AND issued_at > $4::timestamptz - interval '1 hour')::int AS destination,
        count(*) FILTER (WHERE source_key=$3 AND issued_at > $4::timestamptz - interval '1 hour')::int AS source
      FROM public_signup_deliveries WHERE channel=$1`, [channel, address, source, now])
    if (!count || count.total >= this.settings.dailyLimit || count.recent || count.destination >= 3 || count.source >= 10) {
      refuse('rate_limited', 429)
    }
    await client.query('INSERT INTO public_signup_deliveries(channel,destination_key,source_key,issued_at) VALUES($1,$2,$3,$4)',
      [channel, address, source, now])
  }

  private async deliver(channel: Channel, destination: string, code: string) {
    try { await this.settings[channel](destination, code) } catch { refuse('unavailable', 503) }
  }

  async start(input: z.input<typeof signupInput>, ip: string) {
    const { company_name, admin_name, email, mobile } = signupInput.parse(input)
    const id = randomUUID()
    const code = codeValue()
    const now = this.now()
    await this.plan(this.pool)
    await transaction(this.pool, async client => {
      await this.lockDeliveries(client)
      await this.reserveDelivery(client, 'sms', mobile, ip, now)
      await client.query('DELETE FROM public_signups WHERE expires_at <= $1', [now])
      await client.query(`INSERT INTO public_signups(id,company_name,admin_name,email,mobile,expires_at,sms_digest,sms_expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [
        id, company_name, admin_name, email, mobile, new Date(+now + minutes(30)),
        this.digest(id, 'sms', code), new Date(+now + minutes(5)),
      ])
    })
    await this.deliver('sms', mobile, code)
    return { signup_id: id }
  }

  private async challenge(client: PoolClient, id: string, now: Date) {
    const row = (await client.query<Challenge>('SELECT * FROM public_signups WHERE id=$1 AND expires_at>$2 FOR UPDATE', [id, now])).rows[0]
    return row ?? refuse('signup_expired', 409)
  }

  async sendEmail(id: string, ip: string) {
    const code = codeValue()
    const now = this.now()
    const email = await transaction(this.pool, async client => {
      await this.lockDeliveries(client)
      const row = await this.challenge(client, id, now)
      if (!row.mobile_verified || row.completed) refuse('invalid_code', 422)
      await this.reserveDelivery(client, 'email', row.email, ip, now)
      await client.query('UPDATE public_signups SET email_digest=$2,email_expires_at=$3,email_attempts=0 WHERE id=$1',
        [id, this.digest(id, 'email', code), new Date(+now + minutes(5))])
      return row.email
    })
    await this.deliver('email', email, code)
    return ok
  }

  private async verify(client: PoolClient, row: Challenge, channel: Channel, code: string, now: Date) {
    const digest = row[`${channel}_digest`]
    const expires = row[`${channel}_expires_at`]
    const attempts = row[`${channel}_attempts`]
    if (!digest || !expires || expires <= now || attempts >= maxAttempts) return false
    if (timingSafeEqual(digest, this.digest(row.id, channel, code))) return true
    if (!row.completed) await client.query(`UPDATE public_signups SET ${channel}_attempts=${channel}_attempts+1 WHERE id=$1`, [row.id])
    return false
  }

  async verifySms(id: string, code: string) {
    const now = this.now()
    const verified = await transaction(this.pool, async client => {
      const row = await this.challenge(client, id, now)
      if (!(await this.verify(client, row, 'sms', code, now))) return false
      await client.query('UPDATE public_signups SET mobile_verified=true WHERE id=$1', [id])
      return true
    })
    if (!verified) refuse('invalid_code', 422)
    return ok
  }

  async verifyEmail(id: string, code: string) {
    const now = this.now()
    const verified = await transaction(this.pool, async client => {
      const row = await this.challenge(client, id, now)
      if (!row.mobile_verified || !(await this.verify(client, row, 'email', code, now))) return false
      if (row.completed) return true
      const plan = await this.plan(client)
      const customerId = randomUUID()
      const claim = await client.query(`INSERT INTO public_signup_trials(customer_id,email,mobile) VALUES($1,$2,$3)
        ON CONFLICT DO NOTHING RETURNING customer_id`, [customerId, row.email, row.mobile])
      if (!claim.rowCount) refuse('trial_already_used', 409)
      await client.query('INSERT INTO customers(id,name,admin_name,admin_login) VALUES($1,$2,$3,$4)',
        [customerId, row.company_name, row.admin_name, row.email])
      await startTrialOn(client, {
        customer_id: customerId, now,
        principal: { kind: 'customer', actor_id: `public-signup:${id}`, customer_id: customerId, tenant_id: null, capabilities: [] },
        request: { kind: 'new', plan_revision_id: this.settings.planId, bundle_revision_ids: [],
          cadence: { unit: 'month', count: 1 }, requested_users: plan.included_users,
          requested_storage_mb: plan.included_storage_mb, requested_extra_branches: 0 },
      })
      await client.query('UPDATE public_signups SET completed=true WHERE id=$1', [id])
      return true
    })
    if (!verified) refuse('invalid_code', 422)
    return ok
  }
}
