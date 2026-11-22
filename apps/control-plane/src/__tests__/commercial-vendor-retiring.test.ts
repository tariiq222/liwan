import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import { url, monthly, money } from './commercial-helpers.js'
import { migrate } from '../db.js'
import { routesB } from '../commercial/routes-b.js'
import { invitationVendorHttp } from '../commercial/invitation-http.js'
import { CommercialHttpError } from '../commercial/lifecycle.js'

const CAPS = ['vendor.read', 'vendor.subscriptions.manage', 'vendor.pricing.manage', 'vendor.billing.manage', 'vendor.tenants.manage'] as any[]
const suite = url ? describe : describe.skip
suite('vendor routes refuse a workspace that is being deleted', () => {
  const pool = new Pool({ connectionString: url })
  async function call(method: string, path: string, body: unknown = {}) {
    const target = new URL(`/v1/commercial${path}`, 'http://liwan.test')
    const input = { method, pathname: target.pathname, raw: JSON.stringify(body), actor: 7, issuer: 'retiring-test', capabilities: CAPS, stepUpFresh: true }
    try {
      const r = path.endsWith('/invitations') ? await invitationVendorHttp(pool, input) : await routesB(pool, input, target)
      return { status: r!.status, code: undefined as string | undefined }
    } catch (e) {
      if (e instanceof CommercialHttpError) return { status: e.status, code: e.code }
      throw e
    }
  }
  /** A deletion request of the customer in `state`; only `deleting` and `deleted` have stopped access. */
  async function deletion(customer: string, state: 'deleting' | 'deleted' | 'confirmed') {
    if (state === 'confirmed') await pool.query(`INSERT INTO tenant_deletion_requests(id,customer_id,state,requested_at,requested_by,confirmed_at,confirmed_by,due_at,renewal_outcome) VALUES($1,$2,'confirmed',now(),'7',now(),'7',now()+interval '30 days','cancelled')`, [randomUUID(), customer])
    else await pool.query(`INSERT INTO tenant_deletion_requests(id,customer_id,state,requested_at,requested_by,confirmed_at,confirmed_by,due_at,due_marked_at,hold_until,deleting_at,committed_at,deleted_at,plan,plan_digest,renewal_outcome,renewal_refusal)
      VALUES($1,$2,$3,now(),'t',now(),'t',now(),now(),now(),now(),CASE WHEN $3='deleted' THEN now() END,CASE WHEN $3='deleted' THEN now() END,'{}'::jsonb,$4,'not_cancellable','no_subscription')`, [randomUUID(), customer, state, 'a'.repeat(64)])
  }
  /** A customer with an active subscription, and optionally a deletion request in `deleting`. */
  async function fixture(state: 'deleting' | 'deleted' | 'confirmed' | null) {
    const customer = randomUUID(), subscription = randomUUID(), order = randomUUID()
    await pool.query("INSERT INTO customers(id,name,admin_name,admin_login) VALUES($1,'Retiring customer','Manager','retiring@example.test')", [customer])
    await pool.query("INSERT INTO subscriptions(id,customer_id,state) VALUES($1,$2,'active')", [subscription, customer])
    if (state) await deletion(customer, state)
    return { customer, subscription, order }
  }
  beforeAll(async () => { await migrate(pool) })
  afterAll(async () => pool.end())

  const reason = 'Retiring workspace check'
  const routes = (f: { customer: string; subscription: string }) => [
    ['suspend', 'POST', `/subscriptions/${f.subscription}/suspend`, { reason }],
    ['resume', 'POST', `/subscriptions/${f.subscription}/resume`, { reason }],
    ['cancel renewal', 'POST', `/subscriptions/${f.subscription}/cancel-renewal`, { reason }],
    ['resume renewal', 'POST', `/subscriptions/${f.subscription}/resume-renewal`, { reason }],
    ['disable auto renew', 'POST', `/subscriptions/${f.subscription}/disable-auto-renew`, { reason }],
    ['extend trial', 'POST', `/trials/${f.subscription}/extend`, { days: 3, reason }],
    ['end trial', 'POST', `/trials/${f.subscription}/end`, { reason }],
    ['start trial', 'POST', `/customers/${f.customer}/trial`, { kind: 'new', plan_revision_id: randomUUID(), bundle_revision_ids: [], cadence: monthly, requested_extra_branches: 0, requested_users: 1, requested_storage_mb: 0 }],
    ['custom terms', 'POST', '/customer-terms', { customer_id: f.customer, reason, base_price: { cadence: monthly, amount: money(100) } }],
    ['customer quote', 'POST', '/customer-quotes', { customer_id: f.customer, kind: 'new', plan_revision_id: randomUUID(), bundle_revision_ids: [], cadence: monthly, requested_extra_branches: 0, requested_users: 1, requested_storage_mb: 0 }],
    ['branch quote', 'POST', '/branch-quotes', { customer_id: f.customer }],
    ['invitation', 'POST', `/customers/${f.customer}/invitations`, {}],
  ] as const
  it.each(routes({ customer: '', subscription: '' }).map(r => r[0]))('%s answers 409 tenant_retiring for a deleting workspace', async name => {
    const f = await fixture('deleting')
    const [, method, path, body] = routes(f).find(r => r[0] === name)!
    expect(await call(method, path, body)).toEqual({ status: 409, code: 'tenant_retiring' })
  })
  it('an order and a payment attempt answer 409 tenant_retiring for a deleting workspace', async () => {
    const f = await fixture(null)
    const quote = randomUUID(), revision = randomUUID()
    await pool.query('INSERT INTO commercial_quotes(id,customer_id,payload,digest,expires_at) VALUES($1,$2,$3,$4,now()+interval \'1 hour\')', [quote, f.customer, '{}', 'd'.repeat(64)])
    await pool.query('INSERT INTO subscription_revisions(id,subscription_id,revision,snapshot,quote_id) VALUES($1,$2,1,$3,$4)', [revision, f.subscription, '{}', randomUUID()])
    // The order exists before the deletion starts; nothing may create or pay one afterwards.
    await pool.query("INSERT INTO orders(id,customer_id,subscription_id,kind,quote_id,target_revision_id,payment_state,fulfillment_state,effective_at,idempotency_key,request_digest,due_now_minor,currency,exponent) VALUES($1,$2,$3,'new',$4,$5,'awaiting_payment','not_started',now(),$6,$7,100,'SAR',2)",
      [f.order, f.customer, f.subscription, quote, revision, randomUUID(), 'e'.repeat(64)])
    await deletion(f.customer, 'deleting')
    expect(await call('POST', '/orders', { quote_id: quote, expected_subscription_revision: 0, idempotency_key: randomUUID() })).toEqual({ status: 409, code: 'tenant_retiring' })
    expect(await call('POST', `/orders/${f.order}/payment-attempts`, {})).toEqual({ status: 409, code: 'tenant_retiring' })
  })
  it('the same routes are not refused as retiring while the workspace is live', async () => {
    const f = await fixture(null)
    for (const name of ['suspend', 'custom terms'] as const) {
      const [, method, path, body] = routes(f).find(r => r[0] === name)!
      const r = await call(method, path, body)
      expect(r.code).not.toBe('tenant_retiring')
      expect(r.status).toBeLessThan(300)
    }
    expect((await call('POST', `/subscriptions/${f.subscription}/resume`, { reason })).status).toBe(200)
  })
  it('a deleted workspace is refused too, and a merely confirmed deletion is not', async () => {
    const deleted = await fixture('deleted')
    expect(await call('POST', `/subscriptions/${deleted.subscription}/suspend`, { reason })).toEqual({ status: 409, code: 'tenant_retiring' })
    // A deletion that is only confirmed has not stopped access yet: the vendor may still act on the customer.
    const confirmed = await fixture('confirmed')
    expect((await call('POST', `/subscriptions/${confirmed.subscription}/suspend`, { reason })).status).toBe(200)
  })
})
