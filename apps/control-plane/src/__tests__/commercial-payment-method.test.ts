import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Pool } from 'pg'
import { AUTO_RENEW_CONSENT_VERSION } from '@liwan/commercial-contracts'
import { signServiceRequest } from '@liwan/commercial-contracts/server'
import { createApp } from '../http.js'
import { generateRenewals } from '../commercial/renewals.js'
import { sendReservedStoredCharges } from '../commercial/token-charge.js'
import { fixedReturnOrigin } from '../commercial/return-origin.js'
import { acceptQuote } from '../commercial/orders.js'
import { createQuoteForCustomer } from '../commercial/quotes.js'
import { PaymentError, paymentAdapterFromEnv } from '../commercial/payment-adapter.js'
import { openMethodToken, paymentMethodKeyFromEnv } from '../commercial/payment-method-crypto.js'
import {
  beginStoredMethodSetup, completeStoredMethodSetup, expireStoredMethodSetups,
  processStoredMethodRevocations, simulatorMethodOptions, turnOffStoredMethod,
} from '../commercial/payment-methods.js'
import { client, money, monthly, setup, url } from './commercial-helpers.js'

const suite = url ? describe : describe.skip
const env = {
  LIWAN_PAYMENT_PROVIDER: 'simulator',
  LIWAN_PAYMENT_METHOD_KEY: Buffer.alloc(32, 5).toString('base64url'),
  LIWAN_PAYMENT_METHOD_KEY_ID: 'fixture-v1',
}
const now = Date.parse('2026-11-10T14:00:00Z')

suite('separate stored-method consent and simulator runtime', () => {
  const pool = new Pool({ connectionString: url })
  const api = client(pool)
  let plan: string

  beforeAll(async () => {
    const { version } = await setup(pool)
    await api('POST', '/catalog/releases', { catalog_version: version, reason: 'Stored-method fixture' })
    const made = await api('POST', '/plans', {
      name: `Stored method ${randomUUID()}`, audience: { kind: 'public' }, term_months: 12, currency: 'SAR',
      prices: [{ cadence: monthly, amount: money(10_000) }], platform_limits: {}, included_bundle_revision_ids: [],
      optional_bundle_revision_ids: [], included_extra_branches: 0, extra_branch_prices: [], extra_branches_limit: 0,
      included_users: 1, included_storage_mb: 0, storage_step_mb: 10240, storage_step_threshold_mb: 102400,
      storage_large_step_mb: 102400, user_prices: [{ cadence: monthly, amount: money(0) }],
      storage_prices: [{ cadence: monthly, amount: money(0) }], policy_revision_id: '6f1c3d8e-0000-4000-8000-000000000001',
      trial_days: 0, grace_days: 2, auto_suspend: true, auto_renew_allowed: true,
    })
    expect(made.status).toBe(201)
    const validated = await api('POST', `/plans/${made.body.id}/validate`, { edit_revision: 1, reason: 'Stored-method fixture' })
    expect(validated.status).toBe(200)
    const published = await api('POST', `/plans/${made.body.id}/publish`, { edit_revision: validated.body.edit_revision, reason: 'Stored-method fixture' })
    expect(published.status).toBe(200)
    plan = published.body.id
  })
  afterAll(async () => { await pool.end() })

  function runtime(overrides: Partial<typeof env> = {}) {
    const config = { ...env, ...overrides }
    const key = paymentMethodKeyFromEnv(config)
    if (!key) throw Error('fixture key invalid')
    return { key, adapter: paymentAdapterFromEnv(config, simulatorMethodOptions(pool, key)) }
  }

  async function fixture() {
    const tenantId = randomUUID(), customerId = randomUUID()
    await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,'Method fixture','saas','dedicated_managed',$2,false)", [tenantId,`method-${tenantId}`])
    await pool.query("INSERT INTO customers(id,name,tenant_id,admin_name,admin_login) VALUES($1,'Method fixture',$2,'Manager',$3)", [customerId,tenantId,`method-${customerId}@example.test`])
    const quote = await createQuoteForCustomer(pool, { customer_id: customerId, request: {
      kind: 'new', plan_revision_id: plan, bundle_revision_ids: [], cadence: monthly, requested_extra_branches: 0,
      requested_users: 1, requested_storage_mb: 0,
    } })
    const { order } = await acceptQuote(pool, { quote_id: quote.id, expected_subscription_revision: 0, idempotency_key: randomUUID() },
      { kind: 'vendor', actor_id: 'fixture', customer_id: null, tenant_id: null, capabilities: ['vendor.subscriptions.manage'] })
    await pool.query("UPDATE orders SET payment_state='paid',fulfillment_state='applied' WHERE id=$1", [order.id])
    await pool.query("UPDATE invoices SET status='paid',paid_at=now() WHERE order_id=$1", [order.id])
    await pool.query(`UPDATE subscriptions SET applied_revision_id=target_revision_id,target_revision_id=NULL,state='active',
      renewal_at='2026-12-10',revision=revision+1 WHERE id=$1`, [order.subscription_id])
    const actor = { customerId, tenantId, actor: '7' }
    const rows = async () => (await pool.query('SELECT * FROM payment_methods WHERE subscription_id=$1 ORDER BY consent_at,id', [order.subscription_id])).rows
    const begin = (r = runtime(), clock = () => now) => beginStoredMethodSetup(pool, {
      ...actor, consentVersion: AUTO_RENEW_CONSENT_VERSION, runtime: r, clock,
    })
    const complete = (methodId: string, r = runtime(), clock = () => now + 1000) => completeStoredMethodSetup(pool, { ...actor, methodId, runtime: r, clock })
    return { ...actor, subscription: order.subscription_id, actor, rows, begin, complete }
  }

  const chargeTime = Date.parse('2026-12-10T08:00:00Z')
  const returnOrigin = fixedReturnOrigin('https://liwan.test')

  async function reserve(f: Awaited<ReturnType<typeof fixture>>, worker: ReturnType<typeof runtime>) {
    const [method] = await f.rows()
    const receipt = randomUUID()
    await pool.query(`INSERT INTO renewal_notices(id,subscription_id,method_id,renewal_date,cadence_unit,cadence_count,amount_minor,currency,exponent,state,sent_at)
      VALUES($1,$2,$3,'2026-12-10','month',1,11500,'SAR',2,'sent','2026-11-30T05:00:00Z')`, [receipt,f.subscription,method.id])
    await pool.query(`INSERT INTO renewal_notices(id,subscription_id,method_id,renewal_date,cadence_unit,cadence_count,amount_minor,currency,exponent)
      VALUES($1,$2,$3,'2026-12-10','month',1,11501,'SAR',2)`, [randomUUID(),f.subscription,method.id])
    const orders = await generateRenewals(pool,{ now: new Date(chargeTime), clock: () => chargeTime, adapter: worker.adapter,
      storedMethodKeyId: worker.key.id, returnOrigin, subscription_id: f.subscription })
    const order = orders[0]!
    const attempt = async () => (await pool.query("SELECT status,sent_at,closed_reason FROM payment_attempts WHERE order_id=$1", [order.id])).rows[0]
    return { order, attempt, run: () => sendReservedStoredCharges(pool,{ runtime: worker, returnOrigin, clock: () => chargeTime }) }
  }

  it('fails closed without a stable key and starts no setup without the current consent version', async () => {
    expect(paymentMethodKeyFromEnv({})).toBeNull()
    expect(paymentMethodKeyFromEnv({ ...env, LIWAN_PAYMENT_METHOD_KEY: 'bad' })).toBeNull()
    expect(paymentMethodKeyFromEnv({ ...env, LIWAN_PAYMENT_METHOD_KEY_ID: '' })).toBeNull()
    const f = await fixture()
    await expect(beginStoredMethodSetup(pool, { ...f.actor, consentVersion: 'outdated', runtime: runtime(), clock: () => now }))
      .rejects.toMatchObject({ code: 'stored_payment_consent_required' })
    await expect(beginStoredMethodSetup(pool, { ...f.actor, consentVersion: AUTO_RENEW_CONSENT_VERSION, runtime: null, clock: () => now }))
      .rejects.toMatchObject({ code: 'stored_payment_unavailable' })
    expect(await f.rows()).toEqual([])
  })

  it('stores one separate consent, binds setup to its tenant and encrypts on first write', async () => {
    const f = await fixture(), other = await fixture()
    const apiRuntime = runtime(), workerRuntime = runtime()
    await Promise.all([f.begin(apiRuntime),f.begin(apiRuntime)])
    const [pending] = await f.rows()
    expect(await f.rows()).toHaveLength(1)
    expect(pending).toMatchObject({ state: 'setup', consent_actor: '7', consent_version: AUTO_RENEW_CONSENT_VERSION,
      consent_at: new Date(now), setup_expires_at: new Date(now+30*60_000), token_ciphertext: null, key_id: null })
    await expect(other.complete(pending.id)).rejects.toMatchObject({ code: 'not_found' })
    await f.complete(pending.id, apiRuntime)
    await f.complete(pending.id, apiRuntime)
    const [active] = await f.rows()
    expect(active).toMatchObject({ state: 'active', key_id: 'fixture-v1', activated_at: new Date(now+1000) })
    const token = openMethodToken(workerRuntime.key, active)
    expect(Buffer.isBuffer(active.token_ciphertext)).toBe(true)
    expect(active.token_ciphertext.includes(Buffer.from(token))).toBe(false)
    expect(JSON.stringify(active)).not.toContain(token)
    expect(() => openMethodToken(workerRuntime.key, { ...active, subscription_id: randomUUID() })).toThrow()
    expect(await workerRuntime.adapter.getToken(token)).toMatchObject({ active: true })
    expect(await runtime().adapter.getToken(token)).toMatchObject({ active: true })
  })

  it('uses separate signed API and worker runtimes without disclosing a token', async () => {
    const f = await fixture(), other = await fixture()
    for (const [name,value] of Object.entries(env)) vi.stubEnv(name,value)
    const config = { installationId:'stored-method-test', key:'fixture-service-admin-'.repeat(3),
      customerCommercialIssuer:'fixture-customer', customerCommercialServiceKey:'fixture-customer-signing-'.repeat(3),
      inventoryPath:'', repositoryRoot:'', python:'python3', stateDir:'' }
    const server = createApp(pool, config).listen(0,'127.0.0.1')
    try {
      await new Promise<void>(resolve => server.once('listening',resolve))
      const address = server.address()
      if (!address || typeof address === 'string') throw Error('fixture listener unavailable')
      async function call(path: string, body: Record<string,unknown>, tenantId = f.tenantId, capabilities = ['subscription.manage']) {
        const raw = JSON.stringify(body)
        const principal = Buffer.from(JSON.stringify({ actor_id:'7',kind:'customer',tenant_id:tenantId,capabilities })).toString('base64')
        const headers = signServiceRequest({ method:'POST',path,body:`liwan-principal:${principal}
${raw}`,actor:7,
          issuer:config.customerCommercialIssuer,key:config.customerCommercialServiceKey })
        return fetch(`http://127.0.0.1:${(address as {port:number}).port}${path}`, {
          method:'POST',body:raw,headers:{...headers,'x-liwan-principal':principal,'content-type':'application/json'},
        })
      }
      const request = { enabled: true, consent: true, consent_version: AUTO_RENEW_CONSENT_VERSION }
      expect((await call('/v1/customer/auto-renew',request,f.tenantId,['subscription.read'])).status).toBe(403)
      const started = await call('/v1/customer/auto-renew',request)
      expect(started.status).toBe(200)
      const setup = (await started.json() as { auto_renew: { setup_id: string; state: string } }).auto_renew
      expect(setup.state).toBe('setup')
      expect((await call('/v1/customer/auto-renew/complete',{ setup_id: setup.setup_id },other.tenantId)).status).toBe(404)
      const done = await call('/v1/customer/auto-renew/complete',{ setup_id: setup.setup_id })
      expect(done.status).toBe(200)
      const body = await done.text(), worker = runtime(), [row] = await f.rows()
      const token = openMethodToken(worker.key,row)
      expect(JSON.parse(body)).toMatchObject({ auto_renew: { state: 'on', method_label: 'simulator' } })
      expect(body).not.toContain(token)
      expect(body).not.toContain('token_ciphertext')
      expect(await worker.adapter.getToken(token)).toMatchObject({ active: true })
      const audit = (await pool.query('SELECT action,metadata FROM audit_events WHERE subject=$1 AND action LIKE $2',[f.subscription,'payment_method.%'])).rows
      expect(JSON.stringify(audit)).not.toContain(token)
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()))
      vi.unstubAllEnvs()
    }
  })

  it('voids due notices and releases an unsent attempt atomically when switched off', async () => {
    const f = await fixture(), worker = runtime()
    await f.begin()
    await f.complete((await f.rows())[0].id)
    const reserved = await reserve(f,worker)
    const charge = vi.spyOn(worker.adapter, 'chargeToken')
    await turnOffStoredMethod(pool,{ ...f.actor, clock: () => chargeTime })
    expect(await reserved.attempt()).toMatchObject({ status:'canceled',closed_reason:'method_off',sent_at:null })
    expect(await reserved.run()).toBe(0)
    expect(charge).not.toHaveBeenCalled()
    const notices = (await pool.query('SELECT state,void_reason FROM renewal_notices WHERE subscription_id=$1 ORDER BY amount_minor',[f.subscription])).rows
    expect(notices).toEqual([{ state:'sent',void_reason:null },{ state:'void',void_reason:'off' }])
  })

  it('allows off while a dispatched outcome is pending and settles only the original send', async () => {
    const f = await fixture(), worker = runtime()
    await f.begin()
    await f.complete((await f.rows())[0].id)
    const reserved = await reserve(f,worker)
    const chargeToken = worker.adapter.chargeToken.bind(worker.adapter)
    let release!: () => void
    const paused = new Promise<void>(resolve => { release = resolve })
    const charge = vi.spyOn(worker.adapter,'chargeToken').mockImplementation(input => {
      const result = chargeToken(input)
      return paused.then(() => result)
    })
    const sending = reserved.run()
    let off: Promise<unknown> | undefined
    try {
      await expect.poll(() => charge.mock.calls.length).toBe(1)
      let offCommitted = false
      off = turnOffStoredMethod(pool,{ ...f.actor, clock: () => chargeTime }).then(() => { offCommitted = true })
      await expect.poll(() => offCommitted).toBe(true)
      expect(await reserved.attempt()).toMatchObject({ status:'unknown',sent_at:expect.any(Date) })
      expect(await f.rows()).toMatchObject([{ state:'revoking' }])
    } finally {
      release()
      await Promise.allSettled([sending,off])
    }
    expect(await sending).toBe(1)
    expect(await reserved.attempt()).toMatchObject({ status:'succeeded' })
    expect(await reserved.run()).toBe(0)
    expect(charge).toHaveBeenCalledTimes(1)
  })

  it('cannot complete an expired setup and admits a fresh separate consent', async () => {
    const f = await fixture()
    await f.begin()
    const [pending] = await f.rows()
    const expires = now+30*60_000
    await expect(f.complete(pending.id, runtime(), () => expires)).rejects.toMatchObject({ code: 'stored_payment_setup_expired' })
    await expireStoredMethodSetups(pool, new Date(expires))
    expect(await f.rows()).toMatchObject([{ state: 'closed', closed_reason: 'setup_expired', token_ciphertext: null }])
    await f.begin(runtime(), () => expires + 1000)
    expect((await f.rows()).map(row => row.state)).toEqual(['closed','setup'])
  })

  it('turns off without a provider call and keeps ciphertext until async revocation succeeds', async () => {
    const f = await fixture()
    const apiRuntime = runtime(), workerRuntime = runtime()
    await f.begin(apiRuntime)
    const [pending] = await f.rows()
    await f.complete(pending.id, apiRuntime)
    const [active] = await f.rows()
    const token = openMethodToken(workerRuntime.key, active)
    const deleteToken = vi.spyOn(workerRuntime.adapter.storedMethods!, 'deleteToken')
      .mockRejectedValueOnce(new PaymentError('provider_unreachable'))
      .mockRejectedValueOnce(new PaymentError('not_found'))
    let time = now+2000
    await turnOffStoredMethod(pool, { ...f.actor, clock: () => time })
    await turnOffStoredMethod(pool, { ...f.actor, clock: () => time })
    expect(deleteToken).not.toHaveBeenCalled()
    expect(await f.rows()).toMatchObject([{ state: 'revoking', token_ciphertext: active.token_ciphertext, key_id: 'fixture-v1' }])
    expect(await workerRuntime.adapter.getToken(token)).toMatchObject({ active: false })
    await processStoredMethodRevocations(pool, { runtime: workerRuntime, clock: () => time })
    expect(await f.rows()).toMatchObject([{ state: 'revoking', revoke_attempts: 1, revoke_next_at: new Date(time+60_000) }])
    time += 59_999
    await processStoredMethodRevocations(pool, { runtime: workerRuntime, clock: () => time })
    expect(deleteToken).toHaveBeenCalledTimes(1)
    time += 1
    await processStoredMethodRevocations(pool, { runtime: workerRuntime, clock: () => time })
    expect(deleteToken).toHaveBeenCalledTimes(2)
    expect(await f.rows()).toMatchObject([{ state: 'closed', closed_reason: 'revoked', token_ciphertext: null, key_id: null }])
  })
})
