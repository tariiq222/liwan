import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { transaction } from '../db.js'
import { SimulatorAdapter } from '../commercial/payment-simulator.js'
import { assertReturnUrl, originAllowed } from '../commercial/payment-adapter.js'
import { createPaymentAttempt } from '../commercial/payments.js'
import { fixedReturnOrigin, returnOriginFromEnv, tenantReturnOrigin } from '../commercial/return-origin.js'
import { setup, url } from './commercial-helpers.js'

describe('return origin allowlist', () => {
  const allowed = ['https://web.example.com', 'https://*.saas.example', 'http://*.dev.test:3000']
  it('accepts an exact origin and any host below a wildcard suffix, with the entry scheme and port', () => {
    for (const origin of ['https://web.example.com', 'https://acme.saas.example', 'https://a.b.saas.example', 'http://acme.dev.test:3000'])
      expect(originAllowed(origin, allowed)).toBe(true)
  })
  it.each(['http://acme.saas.example', 'https://saas.example', 'https://evilsaas.example', 'https://acme.saas.example.evil.com', 'https://acme.dev.test', 'http://acme.dev.test:3001', 'https://other.example.com'])('refuses %s', origin => {
    expect(originAllowed(origin, allowed)).toBe(false)
  })
  it('never lets a one-label wildcard match', () => {
    expect(originAllowed('https://anything.com', ['https://*.com'])).toBe(false)
  })
  it('applies the same rules to the final provider URL', () => {
    expect(assertReturnUrl('https://acme.saas.example/api/commercial/payment-callback?attempt=1', allowed)).toContain('acme.saas.example')
    expect(() => assertReturnUrl('https://evil.example/x', allowed)).toThrow(/return_url_forbidden/)
  })
})

const suite = url ? describe : describe.skip
suite('per-tenant payment return origins on PostgreSQL', () => {
  const pool = new Pool({ connectionString: url, max: 4 })
  const allowed = ['https://*.saas.example']
  beforeAll(async () => { await setup(pool) })
  beforeEach(async () => { await pool.query('TRUNCATE customers CASCADE'); await pool.query('TRUNCATE commercial_outbox') })
  afterAll(async () => { await pool.end() })

  /** A customer with a payable order; `host` null leaves its tenant without a registry binding. Registry hosts are permanent and unique, so `@` stands for a per-call token. */
  async function customer(hostTemplate: string | null, enabled = true) {
    const tenant = randomUUID(), id = randomUUID(), sub = randomUUID(), revision = randomUUID(), order = randomUUID(), invoice = randomUUID(), slug = `t${tenant.replaceAll('-', '').slice(0, 12)}`, host = hostTemplate?.replace('@', slug) ?? null
    await transaction(pool, async c => {
      await c.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,$2,'saas','managed',$3,true)", [tenant, 'Return origin', `shared-${slug}`])
      if (host) await c.query('INSERT INTO shared_registry_bindings(control_tenant_id,tenant_id,host,database_name,filestore,enabled,registry_revision) VALUES($1,$2,$3,$4,$4,$5,1)', [tenant, slug, host, `db_${slug}`, enabled])
      await c.query('INSERT INTO customers(id,name,tenant_id) VALUES($1,$2,$3)', [id, 'Return origin', tenant])
      await c.query('INSERT INTO subscriptions(id,customer_id) VALUES($1,$2)', [sub, id])
      await c.query('INSERT INTO subscription_revisions(id,subscription_id,revision,snapshot,quote_id) VALUES($1,$2,1,$3,$4)', [revision, sub, '{}', randomUUID()])
      await c.query(`INSERT INTO orders(id,customer_id,subscription_id,kind,quote_id,target_revision_id,payment_state,fulfillment_state,idempotency_key,request_digest,due_now_minor,currency,exponent)
        VALUES($1,$2,$3,'new',$4,$5,'awaiting_payment','not_started',$6,'fixture',11500,'SAR',2)`, [order, id, sub, randomUUID(), revision, randomUUID()])
      await c.query(`INSERT INTO invoices(id,customer_id,subscription_id,order_id,kind,currency,exponent,subtotal_minor,tax_minor,total_minor,period_start,period_end,due_at)
        VALUES($1,$2,$3,$4,'initial','SAR',2,10000,1500,11500,'2026-01-01','2026-02-01',now())`, [invoice, id, sub, order])
    })
    return { id, order, host }
  }
  const attemptRows = async () => (await pool.query('SELECT count(*)::int AS n FROM payment_attempts')).rows[0].n

  it('gives two tenants in shared mode their own return origin', async () => {
    const acme = await customer('acme-@.saas.example'), globex = await customer('globex-@.saas.example')
    const adapter = new SimulatorAdapter(), create = vi.spyOn(adapter, 'createAttempt'), returnOrigin = tenantReturnOrigin(pool, allowed)
    await createPaymentAttempt(pool, { order_id: acme.order, customer_id: acme.id, adapter, returnOrigin })
    await createPaymentAttempt(pool, { order_id: globex.order, customer_id: globex.id, adapter, returnOrigin })
    const urls = create.mock.calls.map(([input]) => new URL(input.callback_url))
    expect(urls.map(u => u.origin)).toEqual([`https://${acme.host}`, `https://${globex.host}`])
    for (const [input] of create.mock.calls) expect([input.success_url, input.back_url]).toEqual([input.callback_url, input.callback_url])
  })
  it.each([
    ['no registry binding', null, true],
    ['a disabled binding', 'acme-@.saas.example', false],
    ['a host outside the allowlist', 'acme-@.elsewhere.example', true],
    ['a host that only embeds the suffix', 'acme-@.saas.example.evil.com', true],
  ] as const)('refuses %s before any write and never borrows another tenant origin', async (_label, host, enabled) => {
    const other = await customer('globex-@.saas.example'), subject = await customer(host, enabled)
    const adapter = new SimulatorAdapter(), create = vi.spyOn(adapter, 'createAttempt')
    await expect(createPaymentAttempt(pool, { order_id: subject.order, customer_id: subject.id, adapter, returnOrigin: tenantReturnOrigin(pool, allowed) }))
      .rejects.toMatchObject({ status: 422, code: 'return_url_forbidden' })
    expect(await attemptRows()).toBe(0)
    expect(create).not.toHaveBeenCalled()
    // The other tenant is unaffected.
    await createPaymentAttempt(pool, { order_id: other.order, customer_id: other.id, adapter, returnOrigin: tenantReturnOrigin(pool, allowed) })
    expect(new URL(create.mock.calls[0]![0].callback_url).origin).toBe(`https://${other.host}`)
  })
  it('keeps one configured origin in dedicated mode and refuses a wildcard there', async () => {
    const a = await customer(null), b = await customer('acme-@.saas.example')
    const dedicated = returnOriginFromEnv(pool, { LIWAN_PAYMENT_RETURN_ORIGINS: 'https://web.example.com, https://other.example.com' })!
    expect(await dedicated(a.id)).toBe('https://web.example.com')
    expect(await dedicated(b.id)).toBe('https://web.example.com')
    await expect(fixedReturnOrigin('https://*.saas.example')(a.id)).rejects.toMatchObject({ status: 422, code: 'return_url_forbidden' })
    expect(returnOriginFromEnv(pool, {})).toBeNull()
    const shared = returnOriginFromEnv(pool, { LIWAN_TENANCY_MODE: 'shared', LIWAN_PAYMENT_RETURN_ORIGINS: 'https://*.saas.example' })!
    expect(await shared(b.id)).toBe(`https://${b.host}`)
    await expect(shared(a.id)).rejects.toMatchObject({ status: 422 })
  })
})
