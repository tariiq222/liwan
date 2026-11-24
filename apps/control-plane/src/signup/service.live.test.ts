import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { client, money, monthly, setup, url } from '../__tests__/commercial-helpers.js'
import type { SignupApp } from '@liwan/commercial-contracts'
import { SignupService } from './service.js'
import { customerView } from '../commercial/customers.js'

const TERMS = '2026-11-01'
const legal = { baseUrl: 'https://liwanos.com', termsVersion: TERMS }
const accepted = { accept_terms: true, terms_version: TERMS, human_token: 'good-token' }
const humanCheck = { siteKey: 'site-key-fixture', scriptUrl: 'https://widget.example.test/api.js', verify: async (token: string) => token === 'good-token' }

const freshSlug = () => `w${randomUUID().replaceAll('-', '').slice(0, 14)}`

describe.skipIf(!url)('public signup on scratch PostgreSQL', () => {
  const pool = new Pool({ connectionString: url })
  let planId: string
  let revisionId: string
  let testNumber = 0
  beforeAll(async () => {
    const { version } = await setup(pool)
    const api = client(pool)
    const release = await api('POST', '/catalog/releases', { catalog_version: version, reason: 'Signup regression' })
    expect(release.status).toBe(201)
    const releaseId = release.body.id
    const bundles = []
    for (const [id, price] of [['crm', 9900], ['inbox', 25000]] as const) {
      const bundle = await api('POST', '/bundles', {
        name: id, description: id, audience: { kind: 'public' }, catalog_release_id: releaseId,
        selections: [{ app_id: id, feature_keys: [id + '.enabled'] }], domain_limits: {},
        prices: [{ cadence: monthly, amount: money(price) }], reason: 'Signup regression',
      })
      expect(bundle.status).toBe(201)
      const path = '/bundles/' + bundle.body.id
      const validated = await api('POST', path + '/validate', { edit_revision: 1, reason: 'Signup regression' })
      expect(validated.status).toBe(200)
      const published = await api('POST', path + '/publish', { edit_revision: validated.body.edit_revision, reason: 'Signup regression' })
      expect(published.status).toBe(200)
      bundles.push(bundle.body.id)
    }
    const draft = await api('POST', '/plans', {
      name: `Trial ${randomUUID()}`, audience: { kind: 'public' }, term_months: 12, currency: 'SAR',
      prices: [{ cadence: monthly, amount: money(0) }], platform_limits: {},
      included_bundle_revision_ids: [], optional_bundle_revision_ids: bundles, included_extra_branches: 0,
      extra_branch_prices: [], extra_branches_limit: 0, included_users: 3, included_storage_mb: 0,
      storage_step_mb: 10240, storage_step_threshold_mb: 102400, storage_large_step_mb: 102400,
      user_prices: [{ cadence: monthly, amount: money(0) }], storage_prices: [{ cadence: monthly, amount: money(0) }],
      policy_revision_id: '6f1c3d8e-0000-4000-8000-000000000002', trial_days: 14, grace_days: 0,
      auto_suspend: true, auto_renew_allowed: false,
    })
    expect(draft.status).toBe(201)
    const path = `/plans/${draft.body.id}`
    const validated = await api('POST', `${path}/validate`, { edit_revision: 1, reason: 'Signup regression' })
    const plan = await api('POST', `${path}/publish`, { edit_revision: validated.body.edit_revision, reason: 'Signup regression' })
    expect(plan.status).toBe(200)
    planId = plan.body.plan_id
    revisionId = plan.body.id
  })
  // Limits are durable, so a test starts from an empty delivery history.
  beforeEach(async () => { await pool.query('TRUNCATE public_signup_deliveries') })
  afterAll(async () => { await pool.end() })

  function fixture(paused = false) {
    const n = ++testNumber
    const ip = `192.0.2.${n}`
    const input = { company_name: 'Signup company', admin_name: 'Administrator',
      email: `trial-${randomUUID()}@${randomUUID()}.test`, mobile: `+966555000${String(n).padStart(3, '0')}`, slug: freshSlug(), ...accepted, offer_revision: revisionId, app_ids: ['crm'] as SignupApp[] }
    let now = new Date()
    let sms = '', email = ''
    const service = new SignupService(pool, {
      planId, legal, humanCheck, paused, secret: 'a'.repeat(32), dailyLimit: 100, now: () => now,
      sms: async (_mobile, code) => { sms = code },
      email: async (_address, code) => { email = code },
    })
    const start = () => service.start(input, ip)
    // Both codes arrive at start; each channel is verified on its own.
    const reachEmail = async () => {
      const { signup_id } = await start()
      await service.verify(signup_id, 'sms', sms)
      await service.verify(signup_id, 'email', email)
      return signup_id
    }
    return { input, ip, service, start, reachEmail, sms: () => sms, email: () => email,
      advance: (minutes: number) => { now = new Date(now.getTime() + minutes * 60_000) } }
  }

  it.each([['crm'], ['inbox'], ['crm', 'inbox']].map(apps => ({ apps: apps as SignupApp[] })))(
    'advertises optional apps and provisions only $apps', async ({ apps }) => {
    const f = fixture()
    f.input.app_ids = apps
    const offer = await f.service.offer()
    expect(offer).toMatchObject({ offer_revision: revisionId, trial_days: 14, apps: [
      { id: 'crm', monthly_minor: 9900 }, { id: 'inbox', monthly_minor: 25000 },
    ] })
    const signupId = await f.reachEmail()
    await f.service.complete(signupId)
    const { rows: [result] } = await pool.query(`SELECT r.snapshot->'entitlement'->'features' AS features
      FROM customers c JOIN subscriptions s ON s.customer_id=c.id
      JOIN subscription_revisions r ON r.id=s.target_revision_id WHERE c.admin_login=$1`, [f.input.email])
    expect(result.features['crm.enabled'] === true).toBe(apps.includes('crm'))
    expect(result.features['inbox.enabled'] === true).toBe(apps.includes('inbox'))
  })

  it('can pause new signups while leaving the workspace lookup widget configuration available', async () => {
    const f = fixture(true)
    expect(f.service.terms()).toHaveProperty('human_check')
    await expect(f.service.offer()).rejects.toMatchObject({ code: 'unavailable' })
    await expect(f.start()).rejects.toMatchObject({ code: 'unavailable' })
    expect(f.sms()).toBe('')
  })

  it('keeps offering the plan after a new revision is published, and refuses a sign-up that was shown the previous one', async () => {
    const api = client(pool)
    const inFlight = fixture()
    const signupId = await inFlight.reachEmail()
    const previous = revisionId
    const created = await api('POST', `/plans/${previous}/revisions`, { edit_revision: 3, reason: 'Next revision' })
    expect(created.status).toBe(201)
    const validated = await api('POST', `/plans/${created.body.id}/validate`, { edit_revision: created.body.edit_revision, reason: 'Next revision' })
    const published = await api('POST', `/plans/${created.body.id}/publish`, { edit_revision: validated.body.edit_revision, reason: 'Next revision' })
    expect(published.status).toBe(200)
    revisionId = published.body.id
    expect((await inFlight.service.offer()).offer_revision).toBe(revisionId)
    await expect(inFlight.service.complete(signupId)).rejects.toMatchObject({ code: 'offer_changed', status: 409 })
    expect((await pool.query('SELECT id FROM customers WHERE admin_login=$1', [inFlight.input.email])).rowCount).toBe(0)
    await expect(inFlight.service.start({ ...inFlight.input, offer_revision: previous }, inFlight.ip)).rejects.toMatchObject({ code: 'offer_changed' })
    const fresh = fixture()
    const freshId = await fresh.reachEmail()
    await expect(fresh.service.complete(freshId)).resolves.toHaveProperty('handoff_secret')
  })

  it('refuses stale or duplicate choices before spending a delivery', async () => {
    const f = fixture()
    await expect(f.service.start({ ...f.input, offer_revision: randomUUID() }, f.ip))
      .rejects.toMatchObject({ code: 'offer_changed' })
    await expect(f.service.start({ ...f.input, app_ids: ['crm', 'crm'] }, f.ip))
      .rejects.toMatchObject({ name: 'ZodError' })
    expect(f.sms()).toBe('')
  })

  it('requires both proofs, then completes concurrent calls into one zero-due order', async () => {
    const f = fixture()
    const { signup_id } = await f.start()
    expect(f.sms()).not.toBe('')
    expect(f.email()).not.toBe('')
    await expect(f.service.complete(signup_id)).rejects.toMatchObject({ code: 'verification_incomplete' })
    await f.service.verify(signup_id, 'email', f.email())
    await expect(f.service.complete(signup_id)).rejects.toMatchObject({ code: 'verification_incomplete' })
    await f.service.verify(signup_id, 'sms', f.sms())
    expect((await pool.query('SELECT id FROM customers WHERE admin_login=$1', [f.input.email])).rowCount).toBe(0)
    const both = await Promise.all([1, 2].map(() => f.service.complete(signup_id)))
    expect(both[0]!.handoff_secret).not.toBe(both[1]!.handoff_secret)
    const wrong = f.email() === '000000' ? '111111' : '000000'
    for (let i = 0; i < 5; i++) {
      await expect(f.service.verify(signup_id, 'email', wrong)).rejects.toMatchObject({ code: 'invalid_code' })
    }
    await expect(f.service.complete(signup_id)).resolves.toHaveProperty('handoff_secret')
    const result = await pool.query(`SELECT o.payment_state,o.fulfillment_state,o.due_now_minor,s.state,
      s.trial_ends_at IS NULL AS awaits_login, c.tenant_id,
      (SELECT count(*)::int FROM commercial_outbox WHERE aggregate_id=o.id::text AND kind='fulfillment.enqueue') AS jobs
      FROM customers c JOIN subscriptions s ON s.customer_id=c.id JOIN orders o ON o.customer_id=c.id WHERE c.admin_login=$1`, [f.input.email])
    expect(result.rows).toEqual([{ payment_state: 'not_required', fulfillment_state: 'queued', due_now_minor: '0',
      state: 'trialing', awaits_login: true, tenant_id: null, jobs: 1 }])
  })

  it('rejects multiline company names before sending', async () => {
    const f = fixture()
    f.input.company_name = 'Acme\nHeadquarters'
    await expect(f.start()).rejects.toMatchObject({ name: 'ZodError' })
    expect(f.sms()).toBe('')
  })

  it('refuses a duplicate verified mobile even with another verified email', async () => {
    const f = fixture()
    const first = await f.reachEmail()
    await f.service.complete(first)
    f.advance(2)
    f.input.email = `other@${randomUUID()}.test`
    f.input.slug = freshSlug()
    const second = await f.reachEmail()
    await expect(f.service.complete(second)).rejects.toMatchObject({ code: 'trial_already_used' })
    expect((await pool.query('SELECT id FROM customers WHERE admin_login=$1', [f.input.email])).rowCount).toBe(0)
  })

  it('commits wrong attempts and refuses a sixth try even with the correct code', async () => {
    const f = fixture()
    const { signup_id } = await f.start()
    const wrong = f.sms() === '000000' ? '111111' : '000000'
    for (let attempt = 0; attempt < 5; attempt++) {
      await expect(f.service.verify(signup_id, 'sms', wrong)).rejects.toMatchObject({ code: 'invalid_code' })
    }
    await expect(f.service.verify(signup_id, 'sms', f.sms())).rejects.toMatchObject({ code: 'invalid_code' })
  })

  it('enforces the durable source limit across IPv6 addresses in one subnet', async () => {
    const f = fixture()
    for (let i = 1; i <= 10; i++) {
      const mobile = `+966555001${String(i).padStart(3, '0')}`
      await f.service.start({ ...f.input, mobile, email: `owner${i}@${randomUUID()}.test` }, `2001:db8:1:2::${i}`)
    }
    await expect(f.service.start({ ...f.input, email: `late@${randomUUID()}.test` }, '2001:db8:1:2::f')).rejects.toMatchObject({ code: 'rate_limited' })
    await expect(f.service.start({ ...f.input, email: `other@${randomUUID()}.test` }, '2001:db8:1:3::1')).resolves.toHaveProperty('signup_id')
  })

  describe('bot check on start', () => {
    const counts = async (f: ReturnType<typeof fixture>) => ({
      deliveries: (await pool.query('SELECT count(*)::int AS n FROM public_signup_deliveries')).rows[0].n,
      signups: (await pool.query('SELECT count(*)::int AS n FROM public_signups WHERE email=$1', [f.input.email])).rows[0].n,
    })

    it('refuses a missing or rejected token before anything is reserved or sent', async () => {
      const f = fixture()
      const { human_token: _token, ...without } = f.input
      await expect(f.service.start(without, f.ip)).rejects.toMatchObject({ code: 'human_check_failed', status: 422 })
      await expect(f.service.start({ ...f.input, human_token: '' }, f.ip)).rejects.toMatchObject({ code: 'human_check_failed', status: 422 })
      await expect(f.service.start({ ...f.input, human_token: 'bad-token' }, f.ip)).rejects.toMatchObject({ code: 'human_check_failed', status: 422 })
      expect(f.sms()).toBe('')
      expect(await counts(f)).toEqual({ deliveries: 0, signups: 0 })
    })

    it('fails closed when the verifier cannot answer: nothing sent, no delivery reserved, retry works later', async () => {
      const f = fixture()
      let up = false
      const sent: string[] = []
      const service = new SignupService(pool, {
        planId, legal, secret: 'a'.repeat(32), dailyLimit: 100,
        humanCheck: { ...humanCheck, verify: async () => { if (!up) throw new Error('human_check_unavailable'); return true } },
        sms: async (_mobile, code) => { sent.push(code) }, email: async () => {},
      })
      await expect(service.start(f.input, f.ip)).rejects.toMatchObject({ code: 'human_check_unavailable', status: 503 })
      expect(sent).toEqual([])
      expect(await counts(f)).toEqual({ deliveries: 0, signups: 0 })
      up = true
      await expect(service.start(f.input, f.ip)).resolves.toHaveProperty('signup_id')
      expect(sent).toHaveLength(1)
    })

    it('hands the client address to the verifier and accepts a good token', async () => {
      const f = fixture()
      const seen: Array<[string, string]> = []
      const service = new SignupService(pool, {
        planId, legal, secret: 'a'.repeat(32), dailyLimit: 100,
        humanCheck: { ...humanCheck, verify: async (token, ip) => { seen.push([token, ip]); return true } },
        sms: async () => {}, email: async () => {},
      })
      await expect(service.start(f.input, f.ip)).resolves.toHaveProperty('signup_id')
      expect(seen).toEqual([['good-token', f.ip]])
    })

    it('does not ask for a token again on resend, and either channel can be asked first', async () => {
      const f = fixture()
      const { signup_id } = await f.start()
      f.advance(2)
      await expect(f.service.resend(signup_id, 'email', f.ip)).resolves.toEqual({ ok: true })
      await expect(f.service.resend(signup_id, 'sms', f.ip)).resolves.toEqual({ ok: true })
    })

    it('publishes the widget settings with the terms', () => {
      expect(fixture().service.terms()).toEqual({ legal_base_url: legal.baseUrl, terms_version: TERMS,
        human_check: { site_key: 'site-key-fixture', script_url: 'https://widget.example.test/api.js' } })
    })
  })

  it('reserves delivery budget even when both senders are unavailable', async () => {
    const f = fixture()
    const service = new SignupService(pool, {
      planId, legal, humanCheck, secret: 'a'.repeat(32), dailyLimit: 100,
      sms: async () => { throw new Error('synthetic transport failure') },
      email: async () => { throw new Error('synthetic transport failure') },
    })
    await expect(service.start(f.input, f.ip)).rejects.toMatchObject({ code: 'unavailable' })
    await expect(service.start(f.input, f.ip)).rejects.toMatchObject({ code: 'rate_limited' })
    expect((await pool.query('SELECT id FROM customers WHERE admin_login=$1', [f.input.email])).rowCount).toBe(0)
  })

  it('keeps the signup open when one channel fails, and a resend of that channel delivers', async () => {
    const f = fixture()
    let smsUp = false
    let sms = ''
    const service = new SignupService(pool, {
      planId, legal, humanCheck, secret: 'a'.repeat(32), dailyLimit: 100, now: () => new Date(Date.now() + (smsUp ? 120_000 : 0)),
      sms: async (_m, code) => { if (!smsUp) throw new Error('down'); sms = code },
      email: async () => {},
    })
    const { signup_id } = await service.start(f.input, f.ip)
    smsUp = true
    await service.resend(signup_id, 'sms', f.ip)
    await expect(service.verify(signup_id, 'sms', sms)).resolves.toEqual({ ok: true })
  })

  it('serializes concurrent issuance and expires codes', async () => {
    const f = fixture()
    const issued = await Promise.allSettled([f.start(), f.start()])
    expect(issued.filter(x => x.status === 'rejected')).toEqual([{
      status: 'rejected', reason: expect.objectContaining({ code: 'rate_limited' }),
    }])
    const successful = issued.find(x => x.status === 'fulfilled')!
    f.advance(6)
    await expect(f.service.verify(successful.value.signup_id, 'sms', f.sms())).rejects.toMatchObject({ code: 'invalid_code' })
  })

  it('refuses a free-mail address before anything is sent or stored', async () => {
    const f = fixture()
    for (const email of ['owner@gmail.com', 'Owner@OUTLOOK.com', 'owner@yahoo.com']) {
      await expect(f.service.start({ ...f.input, email }, f.ip)).rejects.toMatchObject({ code: 'business_email_required', status: 422 })
    }
    expect(f.sms()).toBe('')
    expect((await pool.query('SELECT 1 FROM public_signup_deliveries')).rowCount).toBe(0)
    expect((await pool.query("SELECT 1 FROM public_signups WHERE email LIKE '%@gmail.com'")).rowCount).toBe(0)
    await expect(f.start()).resolves.toHaveProperty('signup_id')
  })

  describe('acceptance of the terms', () => {
    it('refuses to start without an acceptance, before anything is sent or stored', async () => {
      const f = fixture()
      const { accept_terms: _accepted, ...unticked } = f.input
      for (const input of [unticked, { ...unticked, accept_terms: false }, { ...unticked, terms_version: undefined }]) {
        await expect(f.service.start(input, f.ip)).rejects.toMatchObject({ code: 'terms_not_accepted', status: 422 })
      }
      expect(f.sms()).toBe('')
      expect((await pool.query('SELECT 1 FROM public_signup_deliveries')).rowCount).toBe(0)
      expect((await pool.query('SELECT 1 FROM public_signups WHERE email=$1', [f.input.email])).rowCount).toBe(0)
    })

    it('refuses a stale or missing terms version with its own code', async () => {
      const f = fixture()
      await expect(f.service.start({ ...f.input, terms_version: '2026-01-01' }, f.ip)).rejects.toMatchObject({ code: 'terms_changed', status: 409 })
      const { terms_version: _version, ...unversioned } = f.input
      await expect(f.service.start(unversioned, f.ip)).rejects.toMatchObject({ code: 'terms_changed', status: 409 })
      expect(f.sms()).toBe('')
      expect((await pool.query('SELECT 1 FROM public_signups WHERE email=$1', [f.input.email])).rowCount).toBe(0)
    })

    it('stores the version, time and client address on the created customer and shows version and time to the vendor', async () => {
      const f = fixture()
      const startedAt = new Date()
      const id = await f.reachEmail()
      await f.service.complete(id)
      const { rows: [claim] } = await pool.query(`SELECT t.customer_id,t.terms_version,t.terms_accepted_at,host(t.terms_accepted_ip) AS ip
        FROM public_signup_trials t JOIN customers c ON c.id=t.customer_id WHERE c.admin_login=$1`, [f.input.email])
      expect(claim).toMatchObject({ terms_version: TERMS, ip: f.ip })
      expect(Math.abs(claim.terms_accepted_at.getTime() - startedAt.getTime())).toBeLessThan(60_000)
      const customer = (await pool.query('SELECT * FROM customers WHERE id=$1', [claim.customer_id])).rows[0]
      const view = await customerView(pool, customer)
      expect(view.signup_acceptance).toEqual({ terms_version: TERMS, accepted_at: claim.terms_accepted_at.toISOString() })
      expect(JSON.stringify(view)).not.toContain(f.ip)
    })

    it('shows no acceptance for a customer the vendor created', async () => {
      const { rows: [customer] } = await pool.query("INSERT INTO customers(id,name,admin_name,admin_login) VALUES($1,'Vendor made','Admin',$2) RETURNING *",
        [randomUUID(), `vendor-${randomUUID()}@example.test`])
      expect((await customerView(pool, customer)).signup_acceptance).toBeNull()
    })
  })

  describe('one trial per company domain', () => {
    // A second person from the same company: another address and another mobile, so only the domain can refuse.
    async function secondSignup(email: string) {
      const second = fixture()
      second.input.email = email
      const id = await second.reachEmail()
      return { second, id, attempt: () => second.service.complete(id) }
    }
    const customersFor = async (email: string) => (await pool.query('SELECT id FROM customers WHERE admin_login=$1', [email])).rowCount
    async function claimed() {
      const first = fixture()
      const domain = `${randomUUID()}.sa`
      first.input.email = `a@${domain}`
      await first.service.complete(await first.reachEmail())
      return { first, domain }
    }

    it('refuses another address and mobile at the same domain, plus-address and subdomain, only after both proofs', async () => {
      const { first, domain } = await claimed()
      expect((await pool.query('SELECT company_domain FROM public_signup_trials t JOIN customers c ON c.id=t.customer_id WHERE c.admin_login=$1', [first.input.email])).rows)
        .toEqual([{ company_domain: domain }])
      for (const email of [`b@${domain}`, `a+1@${domain}`, `D@${domain.toUpperCase()}`, `c@mail.${domain}`]) {
        const { second, id, attempt } = await secondSignup(email)
        // Starting, the SMS code and the email code all go out normally: nothing says the company already has a trial.
        expect(second.email()).not.toBe('')
        await expect(attempt()).rejects.toMatchObject({ code: 'trial_already_used', status: 409 })
        expect(await customersFor(email)).toBe(0)
        expect((await pool.query('SELECT completed FROM public_signups WHERE id=$1', [id])).rows).toEqual([{ completed: false }])
      }
    })

    it('does not reveal an existing company at start or at either code', async () => {
      const { domain } = await claimed()
      const f = fixture()
      f.input.email = `b@${domain}`
      const { signup_id } = await f.start()
      await expect(f.service.verify(signup_id, 'sms', f.sms())).resolves.toEqual({ ok: true })
      await expect(f.service.verify(signup_id, 'email', f.email())).resolves.toEqual({ ok: true })
    })

    it('keeps com.sa style suffixes apart: x.com.sa and y.com.sa are different companies', async () => {
      const x = fixture(), y = fixture()
      const suffix = randomUUID().slice(0, 8)
      x.input.email = `a@x${suffix}.com.sa`
      y.input.email = `a@y${suffix}.com.sa`
      await x.service.complete(await x.reachEmail())
      await y.service.complete(await y.reachEmail())
      expect(await customersFor(x.input.email)).toBe(1)
      expect(await customersFor(y.input.email)).toBe(1)
      const { attempt } = await secondSignup(`b@mail.x${suffix}.com.sa`)
      await expect(attempt()).rejects.toMatchObject({ code: 'trial_already_used' })
    })

    it('does not let one sign-up squat a country suffix that is not in any list', async () => {
      const a = fixture(), b = fixture()
      const suffix = randomUUID().slice(0, 8)
      a.input.email = `a@firm${suffix}.com.ng`
      b.input.email = `b@other${suffix}.com.ng`
      await a.service.complete(await a.reachEmail())
      await b.service.complete(await b.reachEmail())
      expect(await customersFor(a.input.email)).toBe(1)
      expect(await customersFor(b.input.email)).toBe(1)
    })

    it('refuses at start an address on a public suffix, a hosting suffix or a free-mail subdomain, sending nothing', async () => {
      const f = fixture()
      for (const email of ['a@com.sa', 'a@co.uk', 'a@acme.github.io', 'a@x.vercel.app', 'a@mail.gmail.com']) {
        await expect(f.service.start({ ...f.input, email }, f.ip)).rejects.toMatchObject({ code: 'business_email_required', status: 422 })
      }
      expect(f.sms()).toBe('')
      expect((await pool.query('SELECT 1 FROM public_signup_deliveries')).rowCount).toBe(0)
    })

    it('leaves a customer the vendor created on the same domain unaffected and the vendor path open', async () => {
      const domain = `${randomUUID()}.sa`
      await pool.query("INSERT INTO customers(id,name,admin_name,admin_login) VALUES($1,'Vendor made','Admin',$2)", [randomUUID(), `boss@${domain}`])
      const f = fixture()
      f.input.email = `a@${domain}`
      await expect(f.service.complete(await f.reachEmail())).resolves.toHaveProperty('handoff_secret')
      // The vendor-created customer holds no claim, so it never blocks and a second vendor-created customer is possible.
      await pool.query("INSERT INTO customers(id,name,admin_name,admin_login) VALUES($1,'Vendor made 2','Admin',$2)", [randomUUID(), `other@${domain}`])
    })

    it('two sign-ups racing for one domain end with one customer', async () => {
      const domain = `${randomUUID()}.sa`
      const people = [fixture(), fixture()]
      people.forEach((p, i) => { p.input.email = `p${i}@${domain}` })
      const ids = await Promise.all(people.map(p => p.reachEmail()))
      const results = await Promise.allSettled(people.map((p, i) => p.service.complete(ids[i]!)))
      expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
      expect(results.filter(r => r.status === 'rejected')).toEqual([{ status: 'rejected', reason: expect.objectContaining({ code: 'trial_already_used' }) }])
      expect((await pool.query('SELECT count(*)::int AS n FROM public_signup_trials WHERE company_domain=$1', [domain])).rows).toEqual([{ n: 1 }])
      expect((await pool.query('SELECT count(*)::int AS n FROM customers WHERE admin_login LIKE $1', [`%@${domain}`])).rows).toEqual([{ n: 1 }])
    })
  })

  describe('limits keyed on the requester', () => {
    const person = (n: number) => ({ company_name: 'Signup company', admin_name: 'Administrator',
      email: `owner@d${n}.example.test`, mobile: `+9665660${String(n).padStart(5, '0')}`, slug: freshSlug(), ...accepted, offer_revision: revisionId, app_ids: ['crm'] as SignupApp[] })
    const cheapService = (now: () => Date) => new SignupService(pool, { planId, legal, humanCheck, secret: 'a'.repeat(32), dailyLimit: 100, now, sms: async () => {}, email: async () => {} })

    it('one client address cannot send more than its daily share, and another address is unaffected', async () => {
      let now = new Date()
      const service = cheapService(() => now)
      for (let n = 1; n <= 20; n++) {
        if (n % 10 === 1 && n > 1) now = new Date(+now + 61 * 60_000)
        await service.start(person(n), '198.51.100.1')
      }
      now = new Date(+now + 61 * 60_000)
      await expect(service.start(person(21), '198.51.100.1')).rejects.toMatchObject({ code: 'rate_limited' })
      await expect(service.start(person(21), '198.51.100.2')).resolves.toHaveProperty('signup_id')
    })

    it('one phone number cannot be sent more than its daily share, whoever asks', async () => {
      let now = new Date()
      const service = cheapService(() => now)
      for (let i = 1; i <= 5; i++) {
        await service.start({ ...person(1), email: `owner@d${i}.example.test` }, `198.51.100.${i}`)
        now = new Date(+now + 61 * 60_000)
      }
      await expect(service.start({ ...person(1), email: 'owner@d9.example.test' }, '198.51.100.99')).rejects.toMatchObject({ code: 'rate_limited' })
      await expect(service.start(person(2), '198.51.100.99')).resolves.toHaveProperty('signup_id')
    })
  })

  describe('workspace slug and the status wait', () => {
    const withOrigin = (f: ReturnType<typeof fixture>) => new SignupService(pool, {
      planId, legal, humanCheck, secret: 'a'.repeat(32), dailyLimit: 100,
      returnOrigin: async () => 'https://acme.example.test', sms: async () => {}, email: async () => {},
    })
    const customerOf = async (slug: string) => (await pool.query('SELECT customer_id,state FROM workspace_slugs WHERE slug=$1', [slug])).rows[0]

    it('answers available, unavailable or invalid, and an unavailable slug stays so when held or retired', async () => {
      const f = fixture()
      const slug = f.input.slug
      await expect(f.service.checkSlug(slug, f.ip)).resolves.toBe('available')
      await expect(f.service.checkSlug(` ${slug.toUpperCase()} `, f.ip)).resolves.toBe('available')
      await expect(f.service.checkSlug('a', f.ip)).resolves.toBe('invalid')
      await expect(f.service.checkSlug('bad_slug!', f.ip)).resolves.toBe('invalid')
      await expect(f.service.checkSlug('admin', f.ip)).resolves.toBe('unavailable')
      await expect(f.service.checkSlug('gov-agency', f.ip)).resolves.toBe('unavailable')
      await f.service.complete(await f.reachEmail())
      expect(await customerOf(slug)).toMatchObject({ state: 'held' })
      await expect(f.service.checkSlug(slug, f.ip)).resolves.toBe('unavailable')
      await pool.query("UPDATE workspace_slugs SET state='retired',retired_at=now() WHERE slug=$1", [slug])
      await expect(f.service.checkSlug(slug, f.ip)).resolves.toBe('unavailable')
    })

    it('limits slug checks to 20 a minute per address, then 200 a day', async () => {
      const f = fixture()
      for (let i = 0; i < 20; i++) await f.service.checkSlug(`probe${i}x`, '203.0.113.9')
      await expect(f.service.checkSlug('probe-over', '203.0.113.9')).rejects.toMatchObject({ code: 'rate_limited', status: 429 })
      await expect(f.service.checkSlug('probe-over', '203.0.113.10')).resolves.toBe('available')
      for (let minute = 0; minute < 9; minute++) {
        f.advance(1.1)
        for (let i = 0; i < 20; i++) await f.service.checkSlug(`day${minute}${i}x`, '203.0.113.11')
      }
      f.advance(1.1)
      for (let i = 0; i < 20; i++) await f.service.checkSlug(`dayz${i}x`, '203.0.113.11').catch(() => {})
      await expect(f.service.checkSlug('dayover', '203.0.113.11')).rejects.toMatchObject({ code: 'rate_limited' })
    })

    it('two signups completing the same slug at once end with one winner and the loser intact', async () => {
      const a = fixture(), b = fixture()
      b.input.slug = a.input.slug
      const ids = await Promise.all([a.reachEmail(), b.reachEmail()])
      const results = await Promise.allSettled([a.service.complete(ids[0]), b.service.complete(ids[1])])
      expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
      expect(results.filter(r => r.status === 'rejected')).toEqual([{ status: 'rejected', reason: expect.objectContaining({ code: 'slug_taken', status: 409 }) }])
      const loser = results[0]!.status === 'rejected' ? ids[0] : ids[1]
      expect((await pool.query('SELECT completed,mobile_verified,email_verified FROM public_signups WHERE id=$1', [loser])).rows)
        .toEqual([{ completed: false, mobile_verified: true, email_verified: true }])
      expect((await pool.query('SELECT count(*)::int AS n FROM workspace_slugs WHERE slug=$1', [a.input.slug])).rows).toEqual([{ n: 1 }])
    })

    it('lets the loser of a slug race complete with another address, keeping both verifications', async () => {
      const first = fixture()
      await first.service.complete(await first.reachEmail())
      const second = fixture()
      second.input.slug = first.input.slug
      const id = await second.reachEmail()
      await expect(second.service.complete(id)).rejects.toMatchObject({ code: 'slug_taken' })
      const other = `${first.input.slug}-two`
      await expect(second.service.complete(id, other)).resolves.toHaveProperty('handoff_secret')
      expect((await pool.query("SELECT state FROM workspace_slugs WHERE slug=$1", [other])).rows).toEqual([{ state: 'held' }])
      expect((await pool.query('SELECT slug,completed FROM public_signups WHERE id=$1', [id])).rows).toEqual([{ slug: other, completed: true }])
    })

    it('never reuses a retired slug', async () => {
      const first = fixture()
      await first.service.complete(await first.reachEmail())
      await pool.query("UPDATE workspace_slugs SET state='retired',retired_at=now() WHERE slug=$1", [first.input.slug])
      const second = fixture()
      second.input.slug = first.input.slug
      await expect(second.service.complete(await second.reachEmail())).rejects.toMatchObject({ code: 'slug_taken' })
    })

    it('answers 404 to a status call without or with a wrong secret, and after the secret expires', async () => {
      const f = fixture()
      const id = await f.reachEmail()
      await expect(f.service.status(id, undefined)).rejects.toMatchObject({ status: 404 })
      const { handoff_secret } = await f.service.complete(id)
      await expect(f.service.status(id, undefined)).rejects.toMatchObject({ status: 404 })
      await expect(f.service.status(id, 'x'.repeat(handoff_secret.length))).rejects.toMatchObject({ status: 404 })
      await expect(f.service.status(randomUUID(), handoff_secret)).rejects.toMatchObject({ status: 404 })
      await expect(f.service.status(id, handoff_secret)).resolves.toEqual({ state: 'preparing' })
      f.advance(25 * 60)
      await expect(f.service.status(id, handoff_secret)).rejects.toMatchObject({ status: 404 })
    })

    it('stores only a digest of the secret and reissues a new one on a repeated complete', async () => {
      const f = fixture()
      const id = await f.reachEmail()
      const first = await f.service.complete(id)
      const second = await f.service.complete(id)
      expect(second.handoff_secret).not.toBe(first.handoff_secret)
      const row = (await pool.query('SELECT handoff_digest FROM public_signups WHERE id=$1', [id])).rows[0]
      expect(row.handoff_digest.toString('utf8')).not.toContain(second.handoff_secret)
      await expect(f.service.status(id, first.handoff_secret)).rejects.toMatchObject({ status: 404 })
      await expect(f.service.status(id, second.handoff_secret)).resolves.toEqual({ state: 'preparing' })
    })

    it('limits status to 30 a minute per signup', async () => {
      const f = fixture()
      const id = await f.reachEmail()
      const { handoff_secret } = await f.service.complete(id)
      for (let i = 0; i < 30; i++) await f.service.status(id, handoff_secret)
      await expect(f.service.status(id, handoff_secret)).rejects.toMatchObject({ code: 'rate_limited', status: 429 })
    })

    it('reports delayed, failed and ready, and hands the link out only until it is accepted', async () => {
      const f = fixture()
      const service = withOrigin(f)
      const id = await f.reachEmail()
      const { handoff_secret } = await f.service.complete(id)
      const { customer_id } = await customerOf(f.input.slug)
      await pool.query("UPDATE workspace_slugs SET created_at=now()-interval '11 minutes' WHERE slug=$1", [f.input.slug])
      await expect(service.status(id, handoff_secret)).resolves.toEqual({ state: 'delayed' })
      await pool.query("UPDATE orders SET fulfillment_state='needs_intervention' WHERE customer_id=$1", [customer_id])
      await expect(service.status(id, handoff_secret)).resolves.toEqual({ state: 'failed' })
      await pool.query("UPDATE orders SET fulfillment_state='applied' WHERE customer_id=$1", [customer_id])
      // The workspace exists but the first fulfillment is not applied yet: still waiting, storage or not.
      const tenantId = randomUUID()
      await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled,status) VALUES($1,'T','saas','shared_managed',$2,true,'active')", [tenantId, `inv-${tenantId}`])
      await pool.query('UPDATE customers SET tenant_id=$2 WHERE id=$1', [customer_id, tenantId])
      await pool.query("UPDATE workspace_slugs SET state='active' WHERE slug=$1", [f.input.slug])
      await expect(service.status(id, handoff_secret)).resolves.toMatchObject({ state: 'delayed' })
      await pool.query('UPDATE subscriptions SET tenant_id=$2,applied_revision_id=target_revision_id,revision=revision+1 WHERE customer_id=$1', [customer_id, tenantId])
      const ready = await service.status(id, handoff_secret)
      expect(ready.state).toBe('ready')
      expect(ready.handoff_url).toMatch(/^https:\/\/acme\.example\.test\/invite\/accept#token=/)
      await pool.query('UPDATE admin_invitations SET consumed_at=now() WHERE tenant_id=$1', [tenantId])
      await expect(service.status(id, handoff_secret)).resolves.toEqual({ state: 'ready' })
    })
  })
})
