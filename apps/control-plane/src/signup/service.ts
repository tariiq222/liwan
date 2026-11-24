import { signupAppsSchema, signupStartSchema, workspaceSlugSchema, normalizeWorkspaceSlug, type SignupApp, type SignupChannel, type SignupStatus } from '@liwan/commercial-contracts'
import { createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import type { Pool, PoolClient } from 'pg'
import { transaction } from '../db.js'
import { CommercialHttpError } from '../commercial/lifecycle.js'
import { startTrialOn } from '../commercial/trial.js'
import { issueHandoffInvitation } from '../commercial/invitations.js'
import { buildInvitationUrl } from '../commercial/invitation-tokens.js'
import type { ReturnOrigin } from '../commercial/return-origin.js'
import { WORKSPACE_DELAY_MS } from '../commercial/workspace-delay-notice.js'
import { companyDomain } from './company-domain.js'
import { isFreeMailAddress } from './free-mail.js'
import { loadSignupOffer, signupCadence } from './offer.js'
import type { HumanCheckSettings } from './human-check.js'

const minutes = (count: number) => count * 60_000
const maxAttempts = 5
const signupDeliveryLock = 1397969237
// Delivery limits. The platform-wide daily ceiling (Settings.dailyLimit) is the last-resort cost cap; these keep one
// requester from spending it. Every count is over the delivery history, which keeps one day.
const DESTINATION_COOLDOWN_MINUTES = 1
const DESTINATION_HOURLY_LIMIT = 3
const DESTINATION_DAILY_LIMIT = 5
const SOURCE_HOURLY_LIMIT = 10
const SOURCE_DAILY_LIMIT = 20
const ok = { ok: true } as const
type Channel = SignupChannel
type SendCode = (destination: string, code: string) => Promise<void>
// The vendor-set legal pages: the terms version a visitor must accept and the site base URL that hosts the texts.
export type LegalSettings = { baseUrl: string; termsVersion: string }
type Settings = { secret: string; planId: string; dailyLimit: number; paused?: boolean; legal: LegalSettings; humanCheck: HumanCheckSettings; sms: SendCode; email: SendCode; returnOrigin?: ReturnOrigin; now?: () => Date }
type Challenge = {
  id: string; company_name: string; admin_name: string; email: string; mobile: string;
  expires_at: Date; mobile_verified: boolean; email_verified: boolean; completed: boolean; slug: string;
  sms_digest: Buffer; sms_expires_at: Date; sms_attempts: number;
  email_digest: Buffer | null; email_expires_at: Date | null; email_attempts: number;
  offer_revision: string | null; app_ids: SignupApp[] | null;
  terms_version: string; terms_accepted_at: Date; terms_accepted_ip: string;
}

// The start form is the shared wire contract: the control plane and the web server parse the same shape.
export const signupInput = signupStartSchema

const HANDOFF_TTL_MS = 24 * 3600_000
const CODE_TTL_MS = minutes(5)
const SLUG_CHECK_LIMITS = [{ max: 20, windowMs: 60_000 }, { max: 200, windowMs: 86_400_000 }] as const
const STATUS_LIMIT = { max: 30, windowMs: 60_000 }

function refuse(code: string, status: number): never { throw new CommercialHttpError(code, status) }
const codeValue = () => String(randomInt(1_000_000)).padStart(6, '0')

export class SignupService {
  private hits = new Map<string, number[]>()
  constructor(private pool: Pool, private settings: Settings) {}

  /** Sliding window per key, held in this process like the other public limiters; true means the call is over the limit. */
  private overLimit(key: string, limit: { max: number; windowMs: number }, now: Date) {
    const kept = (this.hits.get(key) ?? []).filter(at => at > +now - limit.windowMs)
    if (kept.length >= limit.max) { this.hits.set(key, kept); return true }
    kept.push(+now)
    this.hits.set(key, kept)
    return false
  }

  private now() { return this.settings.now?.() ?? new Date() }
  private key(...parts: string[]) { return createHmac('sha256', this.settings.secret).update(JSON.stringify(parts)).digest() }
  private digest(id: string, channel: Channel, code: string) { return this.key('otp', id, channel, code) }

  async offer() {
    if (this.settings.paused) refuse('unavailable', 503)
    return (await transaction(this.pool, client => loadSignupOffer(client, this.settings.planId))).offer
  }

  /** The current offer of the plan, only when it is still the revision the visitor was shown: a newer one means new terms to see. */
  private async selectedOffer(client: PoolClient, revision: string | null) {
    let current: Awaited<ReturnType<typeof loadSignupOffer>>
    try { current = await loadSignupOffer(client, this.settings.planId) } catch (error) {
      if (error instanceof CommercialHttpError && error.status === 503) refuse('offer_changed', 409)
      throw error
    }
    if (revision !== current.offer.offer_revision) refuse('offer_changed', 409)
    return current
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
    const { rows: [count] } = await client.query<{ total: number; recent: number; destination: number; destination_day: number; source: number; source_day: number }>(`
      SELECT count(*)::int AS total,
        count(*) FILTER (WHERE destination_key=$2 AND issued_at > $4::timestamptz - make_interval(mins => $5))::int AS recent,
        count(*) FILTER (WHERE destination_key=$2 AND issued_at > $4::timestamptz - interval '1 hour')::int AS destination,
        count(*) FILTER (WHERE destination_key=$2)::int AS destination_day,
        count(*) FILTER (WHERE source_key=$3 AND issued_at > $4::timestamptz - interval '1 hour')::int AS source,
        count(*) FILTER (WHERE source_key=$3)::int AS source_day
      FROM public_signup_deliveries WHERE channel=$1`, [channel, address, source, now, DESTINATION_COOLDOWN_MINUTES])
    if (!count || count.total >= this.settings.dailyLimit || count.recent ||
        count.destination >= DESTINATION_HOURLY_LIMIT || count.destination_day >= DESTINATION_DAILY_LIMIT ||
        count.source >= SOURCE_HOURLY_LIMIT || count.source_day >= SOURCE_DAILY_LIMIT) {
      refuse('rate_limited', 429)
    }
    await client.query('INSERT INTO public_signup_deliveries(channel,destination_key,source_key,issued_at) VALUES($1,$2,$3,$4)',
      [channel, address, source, now])
  }

  private async deliver(channel: Channel, destination: string, code: string) {
    try { await this.settings[channel](destination, code) } catch { refuse('unavailable', 503) }
  }

  /** What the sign-up page shows before the visitor accepts: the legal pages' base URL, the current terms version and the bot-check widget. */
  terms() {
    const { legal, humanCheck } = this.settings
    return { legal_base_url: legal.baseUrl, terms_version: legal.termsVersion,
      human_check: { site_key: humanCheck.siteKey, script_url: humanCheck.scriptUrl } }
  }

  // Runs before any delivery reservation or SMS: a refusal or an outage must cost nothing. An outage fails closed.
  private async requireHuman(token: string | undefined, ip: string) {
    if (!token) refuse('human_check_failed', 422)
    let passed: boolean
    try { passed = await this.settings.humanCheck.verify(token, ip) } catch { refuse('human_check_unavailable', 503) }
    if (!passed) refuse('human_check_failed', 422)
  }

  async start(input: z.input<typeof signupInput>, ip: string) {
    if (this.settings.paused) refuse('unavailable', 503)
    const { company_name, admin_name, email, mobile, slug, accept_terms, terms_version, human_token, offer_revision, app_ids } = signupInput.parse(input)
    if (accept_terms !== true) refuse('terms_not_accepted', 422)
    // The vendor changed the terms while the form was open: the visitor has not seen the current text.
    if (terms_version !== this.settings.legal.termsVersion) refuse('terms_changed', 409)
    // A free-mail host, an address directly on a public suffix or on a shared-hosting suffix names no company.
    if (isFreeMailAddress(email) || companyDomain(email) === null) refuse('business_email_required', 422)
    await this.requireHuman(human_token, ip)
    const id = randomUUID()
    const codes = { sms: codeValue(), email: codeValue() }
    const now = this.now()
    await transaction(this.pool, async client => {
      await this.selectedOffer(client, offer_revision)
      await this.lockDeliveries(client)
      await this.reserveDelivery(client, 'sms', mobile, ip, now)
      await this.reserveDelivery(client, 'email', email, ip, now)
      await client.query('DELETE FROM public_signups WHERE expires_at <= $1', [now])
      await client.query(`INSERT INTO public_signups(id,company_name,admin_name,email,mobile,slug,expires_at,sms_digest,sms_expires_at,
          email_digest,email_expires_at,terms_version,terms_accepted_at,terms_accepted_ip,offer_revision,app_ids)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`, [
        id, company_name, admin_name, email, mobile, slug, new Date(+now + minutes(30)),
        this.digest(id, 'sms', codes.sms), new Date(+now + CODE_TTL_MS), this.digest(id, 'email', codes.email), new Date(+now + CODE_TTL_MS),
        terms_version, now, ip, offer_revision, app_ids,
      ])
    })
    // One channel failing leaves the signup open: the visitor asks for that code again.
    const sent = await Promise.allSettled([this.deliver('sms', mobile, codes.sms), this.deliver('email', email, codes.email)])
    if (sent.every(result => result.status === 'rejected')) refuse('unavailable', 503)
    return { signup_id: id }
  }

  private async challenge(client: PoolClient, id: string, now: Date) {
    const row = (await client.query<Challenge>('SELECT * FROM public_signups WHERE id=$1 AND expires_at>$2 FOR UPDATE', [id, now])).rows[0]
    return row ?? refuse('signup_expired', 409)
  }

  async resend(id: string, channel: Channel, ip: string) {
    const code = codeValue()
    const now = this.now()
    const destination = await transaction(this.pool, async client => {
      await this.lockDeliveries(client)
      const row = await this.challenge(client, id, now)
      if (row.completed) refuse('invalid_code', 422)
      const to = channel === 'sms' ? row.mobile : row.email
      await this.reserveDelivery(client, channel, to, ip, now)
      await client.query(`UPDATE public_signups SET ${channel}_digest=$2,${channel}_expires_at=$3,${channel}_attempts=0 WHERE id=$1`,
        [id, this.digest(id, channel, code), new Date(+now + CODE_TTL_MS)])
      return to
    })
    await this.deliver(channel, destination, code)
    return ok
  }

  private async verifyCode(client: PoolClient, row: Challenge, channel: Channel, code: string, now: Date) {
    const digest = row[`${channel}_digest`]
    const expires = row[`${channel}_expires_at`]
    const attempts = row[`${channel}_attempts`]
    if (!digest || !expires || expires <= now || attempts >= maxAttempts) return false
    if (timingSafeEqual(digest, this.digest(row.id, channel, code))) return true
    if (!row.completed) await client.query(`UPDATE public_signups SET ${channel}_attempts=${channel}_attempts+1 WHERE id=$1`, [row.id])
    return false
  }

  /** Each channel is verified alone; neither needs the other first. */
  async verify(id: string, channel: Channel, code: string) {
    const now = this.now()
    const verified = await transaction(this.pool, async client => {
      const row = await this.challenge(client, id, now)
      if (!(await this.verifyCode(client, row, channel, code, now))) return false
      await client.query(`UPDATE public_signups SET ${channel === 'sms' ? 'mobile_verified' : 'email_verified'}=true WHERE id=$1`, [id])
      return true
    })
    if (!verified) refuse('invalid_code', 422)
    return ok
  }

  /** Both proofs in: reserve the slug, start the trial and hand back the one-time secret that unlocks the status wait. */
  async complete(id: string) {
    const now = this.now()
    const secret = randomBytes(32).toString('base64url')
    await transaction(this.pool, async client => {
      const row = await this.challenge(client, id, now)
      if (!row.mobile_verified || !row.email_verified) refuse('verification_incomplete', 422)
      if (!row.completed) await this.startWorkspace(client, row, now)
      await client.query('UPDATE public_signups SET handoff_digest=$2,handoff_expires_at=$3,expires_at=$3,completed=true WHERE id=$1',
        [id, this.key('handoff', secret), new Date(+now + HANDOFF_TTL_MS)])
    })
    return { handoff_secret: secret }
  }

  private async startWorkspace(client: PoolClient, row: Challenge, now: Date) {
    const selection = signupAppsSchema.safeParse(row.app_ids)
    if (!selection.success) refuse('offer_changed', 409)
    const { offer, bundles } = await this.selectedOffer(client, row.offer_revision)
    const chosen = bundles.filter(bundle => selection.data.some(app => app === bundle.selections[0]?.app_id))
    const customerId = randomUUID()
    const domain = companyDomain(row.email) ?? refuse('invalid', 422)
    await client.query('INSERT INTO customers(id,name,admin_name,admin_login) VALUES($1,$2,$3,$4)',
      [customerId, row.company_name, row.admin_name, row.email])
    // The slug primary key decides a race between two signups; the loser rolls back with its verifications intact.
    const slug = await client.query("INSERT INTO workspace_slugs(slug,customer_id,state) VALUES($1,$2,'held') ON CONFLICT DO NOTHING", [row.slug, customerId])
    if (!slug.rowCount) refuse('slug_taken', 409)
    // One trial per email, mobile and company (registrable domain). The unique keys decide a race; the refusal comes
    // only here, after both proofs, so an anonymous visitor cannot probe which companies already have an account.
    const claim = await client.query(`INSERT INTO public_signup_trials(customer_id,email,mobile,company_domain,terms_version,terms_accepted_at,terms_accepted_ip,requires_first_login)
      VALUES($1,$2,$3,$4,$5,$6,$7,true) ON CONFLICT DO NOTHING RETURNING customer_id`,
    [customerId, row.email, row.mobile, domain, row.terms_version, row.terms_accepted_at, row.terms_accepted_ip])
    if (!claim.rowCount) refuse('trial_already_used', 409)
    await startTrialOn(client, {
      customer_id: customerId, now, waitForFirstLogin: true,
      principal: { kind: 'customer', actor_id: `public-signup:${row.id}`, customer_id: customerId, tenant_id: null, capabilities: [] },
      request: { kind: 'new', plan_revision_id: offer.offer_revision, bundle_revision_ids: chosen.map(bundle => bundle.id),
        cadence: signupCadence, requested_users: offer.included_users,
        requested_storage_mb: offer.included_storage_mb, requested_extra_branches: 0 },
    })
  }

  /** available | unavailable | invalid only; a reserved, held, active or retired slug all read as unavailable. */
  async checkSlug(input: string, ip: string): Promise<'available' | 'unavailable' | 'invalid'> {
    const now = this.now()
    if (SLUG_CHECK_LIMITS.some((limit, index) => this.overLimit(`slug:${index}:${ip}`, limit, now))) refuse('rate_limited', 429)
    const parsed = workspaceSlugSchema.safeParse(normalizeWorkspaceSlug(input))
    if (!parsed.success) return parsed.error.issues.some(issue => issue.message === 'workspace_slug_reserved') ? 'unavailable' : 'invalid'
    const taken = await this.pool.query('SELECT 1 FROM workspace_slugs WHERE slug=$1', [parsed.data])
    return taken.rowCount ? 'unavailable' : 'available'
  }

  /** The wait after complete. The header secret is the only credential: a wrong, missing or expired one answers 404 like an unknown signup. */
  async status(id: string, secret: string | undefined): Promise<SignupStatus> {
    const now = this.now()
    if (this.overLimit(`status:${id}`, STATUS_LIMIT, now)) refuse('rate_limited', 429)
    const row = (await this.pool.query<{ slug: string; handoff_digest: Buffer | null; handoff_expires_at: Date | null }>(
      'SELECT slug,handoff_digest,handoff_expires_at FROM public_signups WHERE id=$1', [id])).rows[0]
    if (!row?.handoff_digest || !row.handoff_expires_at || row.handoff_expires_at <= now || !secret) refuse('not_found', 404)
    const given = this.key('handoff', secret)
    if (given.length !== row.handoff_digest.length || !timingSafeEqual(given, row.handoff_digest)) refuse('not_found', 404)
    const w = (await this.pool.query(`SELECT w.customer_id,w.state,w.created_at,c.tenant_id,c.admin_login,s.applied_revision_id,
        EXISTS(SELECT 1 FROM orders o WHERE o.subscription_id=s.id AND o.fulfillment_state IN ('failed','needs_intervention')) AS failed,
        EXISTS(SELECT 1 FROM shared_onboardings so JOIN shared_jobs j ON j.id=so.job_id WHERE so.control_tenant_id=c.tenant_id AND j.state='needs_intervention') AS stuck
      FROM workspace_slugs w JOIN customers c ON c.id=w.customer_id LEFT JOIN subscriptions s ON s.customer_id=c.id
      WHERE w.slug=$1`, [row.slug])).rows[0]
    if (!w) refuse('not_found', 404)
    if (w.failed || w.stuck) return { state: 'failed' }
    // Storage never gates readiness: only the applied first fulfillment on an active host does.
    if (w.state !== 'active' || !w.tenant_id || !w.applied_revision_id) {
      return { state: +now - +new Date(w.created_at) > WORKSPACE_DELAY_MS ? 'delayed' : 'preparing' }
    }
    const accepted = await this.pool.query('SELECT 1 FROM admin_invitations WHERE tenant_id=$1 AND admin_login=$2 AND consumed_at IS NOT NULL', [w.tenant_id, w.admin_login])
    if (accepted.rowCount) return { state: 'ready' }
    if (!this.settings.returnOrigin) refuse('unavailable', 503)
    const origin = await this.settings.returnOrigin(w.customer_id)
    const { token } = await issueHandoffInvitation(this.pool, w.customer_id)
    return { state: 'ready', handoff_url: buildInvitationUrl(origin, token) }
  }
}
