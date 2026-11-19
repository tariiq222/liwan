import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Pool } from 'pg'
import { publicPricingSchema } from '@liwan/commercial-contracts'
import { signServiceRequest } from '@liwan/commercial-contracts/server'
import { client, money, monthly, setup, url } from '../__tests__/commercial-helpers.js'
import type { MailAdapter } from '../commercial/mail-adapter.js'
import { CONTACT_NOTICE_KIND, purgeContactRequests, sendContactNotices } from './contact-requests.js'
import { PUBLIC_CONTACT_PATH, PUBLIC_PRICING_PATH, publicSiteHandler, CONTACT_VISITOR_LIMIT } from './http.js'

const yearly = { unit: 'year' as const, count: 1 }
const service = { issuer: 'public-site-test', key: 'public-site-key'.repeat(3) }
const ip = '192.0.2.10'
const valid = { name: 'Sara', email: 'sara@acme.com.sa', company: 'Acme', mobile: '+966555000111', message: 'We want a demo', lang: 'ar', consent: true, turnstile_token: 'good' }

describe.skipIf(!url)('public site routes on scratch PostgreSQL', () => {
  const pool = new Pool({ connectionString: url })
  let planId: string
  beforeAll(async () => {
    const { version } = await setup(pool)
    // Other suites on the same scratch database edit the vendor's billing settings; this one states its own.
    await pool.query("UPDATE billing_settings SET refund_window_days=14, onboarding_fee_minor=49900, onboarding_currency='SAR', onboarding_exponent=2 WHERE singleton")
    const api = client(pool)
    const release = await api('POST', '/catalog/releases', { catalog_version: version, reason: 'Public site' })
    const bundles: string[] = []
    for (const [id, price] of [['crm', 9900], ['inbox', 25000]] as const) {
      const bundle = await api('POST', '/bundles', { name: id, description: id, audience: { kind: 'public' }, catalog_release_id: release.body.id,
        selections: [{ app_id: id, feature_keys: [id + '.enabled'] }], domain_limits: {},
        prices: [{ cadence: monthly, amount: money(price) }, { cadence: yearly, amount: money(price * 10) }], reason: 'Public site' })
      const validated = await api('POST', `/bundles/${bundle.body.id}/validate`, { edit_revision: 1, reason: 'Public site' })
      await api('POST', `/bundles/${bundle.body.id}/publish`, { edit_revision: validated.body.edit_revision, reason: 'Public site' })
      bundles.push(bundle.body.id)
    }
    const draft = await api('POST', '/plans', {
      name: `Public ${randomUUID()}`, audience: { kind: 'public' }, term_months: 12, currency: 'SAR',
      prices: [{ cadence: monthly, amount: money(0) }], platform_limits: {}, included_bundle_revision_ids: [], optional_bundle_revision_ids: bundles,
      included_extra_branches: 1, extra_branch_prices: [], extra_branches_limit: 1, included_users: 3, included_storage_mb: 20480,
      storage_step_mb: 10240, storage_step_threshold_mb: 102400, storage_large_step_mb: 102400,
      user_prices: [{ cadence: monthly, amount: money(2900) }, { cadence: yearly, amount: money(29000) }],
      storage_prices: [{ cadence: monthly, amount: money(100) }, { cadence: yearly, amount: money(1000) }],
      policy_revision_id: '6f1c3d8e-0000-4000-8000-000000000002', trial_days: 14, grace_days: 0, auto_suspend: true, auto_renew_allowed: false })
    expect(draft.status, JSON.stringify(draft.body)).toBe(201)
    const validated = await api('POST', `/plans/${draft.body.id}/validate`, { edit_revision: 1, reason: 'Public site' })
    expect(validated.status, JSON.stringify(validated.body)).toBe(200)
    const plan = await api('POST', `/plans/${draft.body.id}/publish`, { edit_revision: validated.body.edit_revision, reason: 'Public site' })
    expect(plan.status).toBe(200)
    planId = plan.body.id
  })
  beforeEach(async () => { await pool.query('TRUNCATE public_contact_requests'); await pool.query("DELETE FROM commercial_outbox WHERE kind=$1", [CONTACT_NOTICE_KIND]) })
  afterAll(async () => { await pool.end() })

  const budgets = () => { const counts = new Map<string, number>(); return (key: string, limit: { max: number }) => { const n = (counts.get(key) ?? 0) + 1; counts.set(key, n); return n > limit.max } }
  const handler = (extra: Partial<Parameters<typeof publicSiteHandler>[1]> = {}) => publicSiteHandler(pool, {
    service, planId, notifyEmail: 'owner@liwanos.com', humanCheck: async token => token === 'good', overLimit: budgets(), bucket: address => address, ...extra })
  const pricingRequest = (raw = '{}') => ({ raw, headers: signServiceRequest({ method: 'POST', path: PUBLIC_PRICING_PATH, body: `liwan-public-pricing:\n${raw}`, actor: 'anonymous', anonymous: true, ...service }) })
  const contactRequest = (body: Record<string, unknown> = valid, address = ip) => {
    const raw = JSON.stringify(body)
    return { raw, headers: { ...signServiceRequest({ method: 'POST', path: PUBLIC_CONTACT_PATH, body: `liwan-public-contact:${address}\n${raw}`, actor: 'anonymous', anonymous: true, ...service }), 'x-liwan-client-ip': address } }
  }
  const post = (h: ReturnType<typeof handler>, path: string, r: { raw: string; headers: Record<string, string> }) => h(path, 'POST', r.raw, r.headers)
  const rows = async () => (await pool.query('SELECT * FROM public_contact_requests')).rows

  describe('pricing', () => {
    it('serves the published offer in the shape the site reads, with no internal field', async () => {
      const answer = await post(handler(), PUBLIC_PRICING_PATH, pricingRequest())
      expect(answer.status).toBe(200)
      expect(publicPricingSchema.parse(answer.data)).toMatchObject({
        schema_version: 1, currency: 'SAR', tax: 'none',
        free: { users: 3, storage_gb: 20, branches: 1 },
        apps: [{ key: 'crm', monthly: 99, annual: 990 }, { key: 'inbox', monthly: 250, annual: 2500 }],
        extra_user: { monthly: 29, annual: 290, max_users: 100 },
        extra_storage: { per_gb_monthly: 1, block_gb: 10, block_monthly: 10, step_gb: 10, step_gb_after: 100, step_gb_large: 100 },
        onboarding: { one_time: 499 }, refund_days: 14,
      })
      expect(JSON.stringify(answer.data)).not.toContain(planId)
    })
    it('is unavailable without a configured plan, or when the plan is not the sign-up offer', async () => {
      expect((await post(handler({ planId: undefined }), PUBLIC_PRICING_PATH, pricingRequest())).status).toBe(503)
      expect((await post(handler({ planId: randomUUID() }), PUBLIC_PRICING_PATH, pricingRequest())).status).toBe(503)
    })
    it('refuses an unsigned or replayed request and a body', async () => {
      const h = handler()
      expect((await h(PUBLIC_PRICING_PATH, 'POST', '{}', {})).status).toBe(403)
      const signed = pricingRequest()
      expect((await post(h, PUBLIC_PRICING_PATH, signed)).status).toBe(200)
      expect((await post(h, PUBLIC_PRICING_PATH, signed)).status).toBe(403)
      expect((await post(h, PUBLIC_PRICING_PATH, pricingRequest('{"x":1}'))).status).toBe(422)
      expect((await h(PUBLIC_PRICING_PATH, 'GET', '', {})).status).toBe(404)
    })
  })

  describe('contact', () => {
    it('stores the request with its owner notice and answers 201', async () => {
      const answer = await post(handler(), PUBLIC_CONTACT_PATH, contactRequest({ ...valid, utm_source: 'ad', users: 12, lang: 'en', extra: 'dropped' }))
      expect(answer).toEqual({ status: 201, data: { ok: true } })
      const [row] = await rows()
      expect(row).toMatchObject({ name: 'Sara', email: 'sara@acme.com.sa', company: 'Acme', mobile: '+966555000111', users: 12, lang: 'en', utm: { utm_source: 'ad' } })
      expect(JSON.stringify(row)).not.toContain('192.0.2.10')
      const outbox = (await pool.query('SELECT payload FROM commercial_outbox WHERE kind=$1', [CONTACT_NOTICE_KIND])).rows
      expect(outbox).toEqual([{ payload: { request_id: row.id } }])
    })
    it.each([
      ['a free-mail address', { email: 'sara@gmail.com' }, 'business_email_required'],
      ['a bad address', { email: 'nope' }, 'invalid_email'],
      ['a bad mobile', { mobile: '0555' }, 'invalid_mobile'],
      ['no consent', { consent: false }, 'consent_required'],
      ['no token', { turnstile_token: undefined }, 'turnstile_required'],
      ['a failed human check', { turnstile_token: 'bad' }, 'turnstile_failed'],
      ['an empty message', { message: '' }, 'validation_failed'],
      ['a message over the cap', { message: 'x'.repeat(2001) }, 'validation_failed'],
    ])('stores nothing for %s', async (_name, patch, code) => {
      const answer = await post(handler(), PUBLIC_CONTACT_PATH, contactRequest({ ...valid, ...patch }))
      expect(answer).toMatchObject({ status: 422, data: { code } })
      expect(await rows()).toHaveLength(0)
    })
    it('stores nothing when the human check cannot answer, and when the owner address is not configured', async () => {
      const broken = handler({ humanCheck: async () => { throw new Error('down') } })
      expect((await post(broken, PUBLIC_CONTACT_PATH, contactRequest())).status).toBe(503)
      expect((await post(handler({ notifyEmail: undefined }), PUBLIC_CONTACT_PATH, contactRequest())).status).toBe(503)
      expect(await rows()).toHaveLength(0)
    })
    it('needs the address signed with the body, refuses a replay, and budgets each address', async () => {
      const h = handler()
      expect((await h(PUBLIC_CONTACT_PATH, 'POST', JSON.stringify(valid), {})).status).toBe(403)
      const signed = contactRequest()
      expect((await post(h, PUBLIC_CONTACT_PATH, { ...signed, headers: { ...signed.headers, 'x-liwan-client-ip': '192.0.2.99' } })).status).toBe(403)
      expect((await post(h, PUBLIC_CONTACT_PATH, signed)).status).toBe(201)
      expect((await post(h, PUBLIC_CONTACT_PATH, signed)).status).toBe(403)
      // The signed request and its replay already spent two of the budget (every signed attempt counts).
      for (let n = 2; n < CONTACT_VISITOR_LIMIT.max; n++) expect((await post(h, PUBLIC_CONTACT_PATH, contactRequest(valid, ip))).status).toBe(201)
      expect((await post(h, PUBLIC_CONTACT_PATH, contactRequest(valid, ip))).status).toBe(429)
      expect((await post(h, PUBLIC_CONTACT_PATH, contactRequest(valid, '192.0.2.11'))).status).toBe(201)
    })
  })

  describe('owner notice and retention', () => {
    const mail = () => { const send = vi.fn(async () => ({ accepted: true, provider_message_id: 'm' })); return { adapter: { send } as MailAdapter, send } }
    it('mails the owner once per request and closes the notice', async () => {
      await post(handler(), PUBLIC_CONTACT_PATH, contactRequest())
      const { adapter, send } = mail()
      expect(await sendContactNotices(pool, { mail: adapter, to: 'owner@liwanos.com' })).toBe(1)
      expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: 'owner@liwanos.com', text: expect.stringContaining('We want a demo') }))
      expect(await sendContactNotices(pool, { mail: adapter, to: 'owner@liwanos.com' })).toBe(0)
      expect((await pool.query("SELECT status FROM commercial_outbox WHERE kind=$1", [CONTACT_NOTICE_KIND])).rows).toEqual([{ status: 'done' }])
    })
    it('keeps the request and retries the notice when the mail is refused', async () => {
      await post(handler(), PUBLIC_CONTACT_PATH, contactRequest())
      const log = vi.fn()
      const refusing = { send: async () => ({ accepted: false, provider_message_id: '' }) } as MailAdapter
      expect(await sendContactNotices(pool, { mail: refusing, to: 'owner@liwanos.com', log })).toBe(0)
      expect(await rows()).toHaveLength(1)
      const [outbox] = (await pool.query("SELECT status,attempts FROM commercial_outbox WHERE kind=$1", [CONTACT_NOTICE_KIND])).rows
      expect(outbox).toEqual({ status: 'pending', attempts: 1 })
      expect(JSON.stringify(log.mock.calls)).not.toContain('sara@acme.com.sa')
    })
    it('deletes requests older than twelve months and keeps recent ones', async () => {
      const insert = (months: number) => pool.query(
        `INSERT INTO public_contact_requests(id,created_at,name,email,message,lang) VALUES($1, now() - make_interval(months => $2), 'N', 'n@acme.sa', 'm', 'ar')`, [randomUUID(), months])
      await insert(13); await insert(25); await insert(11)
      expect(await purgeContactRequests(pool)).toBe(2)
      expect(await rows()).toHaveLength(1)
    })
  })
})
