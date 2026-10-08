import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import { mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { url, setup, client, monthly, money } from './commercial-helpers.js'
import { acceptQuote } from '../commercial/orders.js'
import { createQuoteForCustomer } from '../commercial/quotes.js'
import { activateBranches, listBranches } from '../commercial/branches.js'
import { transaction } from '../db.js'
import { applyReceipt, processFulfillmentOutbox } from '../commercial/fulfillment.js'
import { routesB } from '../commercial/routes-b.js'

const suite = url ? describe : describe.skip
suite('commercial first enrollment on scratch PostgreSQL', () => {
  const pool = new Pool({ connectionString: url, max: 8 })
  const actor = { issuer: `enroll-${randomUUID()}`, actorUid: 7 }
  let config: any, release: string
  beforeAll(async () => {
    vi.stubEnv('NASQ_TENANCY_MODE', 'shared')
    const { version } = await setup(pool)
    release = (await client(pool)('POST', '/catalog/releases', { catalog_version: version, reason: 'Enrollment regression' })).body.id
    const root = await realpath(await mkdtemp(join(tmpdir(), 'nasq-enroll-')))
    const runtime = { schemaVersion: 1, projectName: 'nasq-saas-enroll', composeFile: join(root, 'compose.yml'), envFile: join(root, 'runtime.env'), stateDir: root, domainSuffix: 'enrollment.test' }
    await writeFile(runtime.composeFile, 'services: {}\n'); await writeFile(runtime.envFile, '')
    await writeFile(join(root, 'runtime.json'), JSON.stringify(runtime))
    config = { installationId: actor.issuer, key: 'scratch-key'.repeat(8), inventoryPath: '/unused', stateDir: root, repositoryRoot: fileURLToPath(new URL('../../../..', import.meta.url)), python: 'python3', sharedRuntimeConfigPath: join(root, 'runtime.json'), tenantRegistryPath: join(root, 'registry.json') }
  })
  afterAll(async () => { vi.unstubAllEnvs(); await pool.end() })
  async function seed(admin = true, payment = 'paid') {
    const customer = randomUUID(), subscription = randomUUID(), target = randomUUID(), order = randomUUID(), archive = randomUUID()
    await pool.query('INSERT INTO customers(id,name,admin_name,admin_login) VALUES($1,$2,$3,$4)', [customer, 'New customer', 'First admin', admin ? `${customer}@example.test` : null])
    await pool.query('INSERT INTO subscriptions(id,customer_id) VALUES($1,$2)', [subscription, customer])
    const entitlement = { catalog_release_id: release, modules: ['nasq_core','nasq_platform','nasq_api'], features: { 'users.limit': 8 }, digest: 'a'.repeat(64), compiler_version: 1 }
    await pool.query('INSERT INTO subscription_revisions(id,subscription_id,revision,snapshot,quote_id) VALUES($1,$2,1,$3,$4)', [target, subscription, { entitlement, period_end: '2027-01-01',branch_archive_ids:[archive] }, randomUUID()])
    await pool.query('UPDATE subscriptions SET target_revision_id=$2,revision=revision+1 WHERE id=$1', [subscription, target])
    await pool.query("INSERT INTO orders(id,customer_id,subscription_id,kind,quote_id,target_revision_id,payment_state,fulfillment_state,idempotency_key,request_digest,due_now_minor,currency,exponent) VALUES($1,$2,$3,'new',$4,$5,$6,'queued',$7,'test',100,'SAR',2)", [order, customer, subscription, randomUUID(), target, payment, randomUUID()])
    await pool.query("INSERT INTO commercial_outbox(id,kind,aggregate_id,dedupe_key) VALUES($1,'fulfillment.enqueue',$2,$3)", [randomUUID(), order, target])
    await pool.query("INSERT INTO commercial_branches(id,subscription_id,name,kind,billing,state,order_id) VALUES($1,$2,'Old extra','extra','paid','active',$3)",[archive,subscription,order])
    return { customer, subscription, order, target, entitlement,archive }
  }
  const process = () => processFulfillmentOutbox(pool, { enrollment: { config } })
  it.each(['paid', 'not_required'])('links one %s new enrollment and waits for verified activation before reconfigure', async payment => {
    const s = await seed(true, payment)
    expect(await process()).toContainEqual({ order_id: s.order, reason: 'enrollment_pending' })
    const customer = (await pool.query('SELECT * FROM customers WHERE id=$1', [s.customer])).rows[0]
    expect(customer.tenant_id).toBe(customer.enrollment_request_id)
    expect((await pool.query('SELECT tenant_id FROM subscriptions WHERE id=$1', [s.subscription])).rows[0].tenant_id).toBe(customer.tenant_id)
    await process(); await process()
    const jobs = (await pool.query('SELECT * FROM shared_jobs WHERE control_tenant_id=$1', [customer.tenant_id])).rows
    expect(jobs).toHaveLength(1); expect(jobs[0].payload.operation).toBe('provision')
    expect(jobs[0].payload.catalog.tier).toBe('core')
    expect((await pool.query('SELECT status FROM commercial_outbox WHERE aggregate_id=$1', [s.order])).rows[0].status).toBe('pending')
    await pool.query("UPDATE tenants SET status='active' WHERE id=$1", [customer.tenant_id])
    await process()
    expect((await pool.query('SELECT status FROM commercial_outbox WHERE aggregate_id=$1', [s.order])).rows[0].status).toBe('pending')
    // Simulate the verified provision/publication boundary; no physical adapter is run.
    await pool.query("UPDATE shared_jobs SET state='verified',receipt=jsonb_build_object('status','verified','payloadDigest',payload_digest) WHERE id=$1", [jobs[0].id])
    await pool.query("UPDATE shared_onboardings SET stage='active' WHERE control_tenant_id=$1", [customer.tenant_id])
    await pool.query('UPDATE shared_registry_bindings SET enabled=true,registry_revision=registry_revision+1 WHERE control_tenant_id=$1', [customer.tenant_id])
    const processed=await process()
    expect(processed.find(x=>x.order_id===s.order)).toMatchObject({job_id:expect.any(String)})
    await process()
    const reconfigure = (await pool.query("SELECT payload FROM shared_jobs WHERE control_tenant_id=$1 AND payload->>'operation'='reconfigure'", [customer.tenant_id])).rows
    expect(reconfigure).toHaveLength(1); expect(reconfigure[0].payload.authority.entitlement).toEqual({modules:s.entitlement.modules,features:s.entitlement.features,digest:s.entitlement.digest,compiler_version:s.entitlement.compiler_version})
    expect(reconfigure[0].payload.authority.branches.archive).toEqual([s.archive])
    expect((await pool.query('SELECT state FROM commercial_branches WHERE id=$1',[s.archive])).rows[0].state).toBe('active')
    expect((await pool.query('SELECT status FROM commercial_outbox WHERE aggregate_id=$1', [s.order])).rows[0].status).toBe('done')
    expect((await pool.query('SELECT count(*)::int AS n FROM commercial_outbox WHERE kind=\'invitation.issue\' AND aggregate_id=$1',[s.subscription])).rows[0].n).toBe(0)
    const receipt={order_id:s.order,tenant_id:customer.tenant_id,target_revision_id:s.target,observed_entitlement_digest:s.entitlement.digest,observed_at:new Date().toISOString(),branch_bindings:[],root_company_id:1}
    await applyReceipt(pool,{order_id:s.order,receipt}); await applyReceipt(pool,{order_id:s.order,receipt})
    expect((await pool.query('SELECT state FROM commercial_branches WHERE id=$1',[s.archive])).rows[0].state).toBe('archived')
    expect((await pool.query('SELECT renewal_at::text AS renewal_at FROM subscriptions WHERE id=$1',[s.subscription])).rows[0].renewal_at).toBe('2027-01-01')
    expect((await pool.query("SELECT kind,billing,state,odoo_company_id FROM commercial_branches WHERE subscription_id=$1 AND kind='hq'",[s.subscription])).rows).toEqual([{kind:'hq',billing:'included',state:'active',odoo_company_id:1}])
    expect((await pool.query('SELECT count(*)::int AS n FROM commercial_outbox WHERE kind=\'invitation.issue\' AND aggregate_id=$1',[s.subscription])).rows[0].n).toBe(1)
    const renewal=randomUUID()
    await pool.query("INSERT INTO orders(id,customer_id,subscription_id,kind,quote_id,target_revision_id,payment_state,fulfillment_state,idempotency_key,request_digest,due_now_minor,currency,exponent) VALUES($1,$2,$3,'renewal',$4,$5,'paid','queued',$6,'test',100,'SAR',2)",[renewal,s.customer,s.subscription,randomUUID(),s.target,randomUUID()])
    await pool.query("INSERT INTO renewals(id,subscription_id,period_start,period_end,order_id,status) VALUES($1,$2,'2027-01-01','2027-02-01',$3,'paid')",[randomUUID(),s.subscription,renewal])
    await pool.query("INSERT INTO commercial_outbox(id,kind,aggregate_id,dedupe_key) VALUES($1,'fulfillment.enqueue',$2,$3)",[randomUUID(),renewal,s.target])
    await process(); await process()
    expect((await pool.query('SELECT renewal_at::text AS renewal_at FROM subscriptions WHERE id=$1',[s.subscription])).rows[0].renewal_at).toBe('2027-02-01')
    expect((await pool.query('SELECT fulfillment_state FROM orders WHERE id=$1',[renewal])).rows[0].fulfillment_state).toBe('applied')
    expect((await pool.query("SELECT count(*)::int AS n FROM shared_jobs WHERE control_tenant_id=$1 AND payload->>'operation'='reconfigure'",[customer.tenant_id])).rows[0].n).toBe(1)
  })
  it('new customer without tenant reserves three extras and enrollment links all pending branches', async () => {
    const api = client(pool)
    const draft = await api('POST', '/plans', { name: `New branches ${randomUUID()}`, audience: { kind: 'public' }, term_months: 12, currency: 'SAR', prices: [{ cadence: monthly, amount: money(10000) }], platform_limits: { 'users.limit': null, 'storage.limit_mb': null }, included_bundle_revision_ids: [], optional_bundle_revision_ids: [], included_extra_branches: 1, extra_branch_prices: [{ cadence: monthly, amount: money(5000) }], extra_branches_limit: 8, policy_revision_id: '6f1c3d8e-0000-4000-8000-000000000001', trial_days: 0, grace_days: 0, auto_suspend: true, auto_renew_allowed: true })
    const validated = await api('POST', `/plans/${draft.body.id}/validate`, { edit_revision: 1, reason: 'New branches regression' })
    const plan = (await api('POST', `/plans/${draft.body.id}/publish`, { edit_revision: validated.body.edit_revision, reason: 'New branches regression' })).body
    const customer = randomUUID()
    await pool.query('INSERT INTO customers(id,name,admin_name,admin_login) VALUES($1,$2,$3,$4)', [customer, 'New branches customer', 'Admin', `${customer}@example.test`])
    const quote = await createQuoteForCustomer(pool, { customer_id: customer, request: { kind: 'new', plan_revision_id: plan.id, bundle_revision_ids: [], cadence: monthly, requested_extra_branches: 3 } })
    const vendor: any = { actor_id: '7', kind: 'vendor', customer_id: null, tenant_id: null, capabilities: ['vendor.subscriptions.manage'] }
    const { order } = await acceptQuote(pool, { quote_id: quote.id, expected_subscription_revision: 0, idempotency_key: randomUUID() }, vendor)
    expect(order).toMatchObject({ kind: 'new', payment_state: 'awaiting_payment' })
    const pending = (await pool.query('SELECT id,name,billing,state,tenant_id FROM commercial_branches WHERE subscription_id=$1 ORDER BY name', [order.subscription_id])).rows
    expect(pending.map(({ id, ...branch }) => branch)).toEqual([
      { name: 'Branch 1', billing: 'free_extra', state: 'pending', tenant_id: null },
      { name: 'Branch 2', billing: 'paid', state: 'pending', tenant_id: null },
      { name: 'Branch 3', billing: 'paid', state: 'pending', tenant_id: null },
    ])
    expect(await listBranches(pool, order.subscription_id)).toMatchObject({ total: 3, hq: 1, free_extra_used: 1, free_extra_allowed: 1, paid: 2 })
    await expect(transaction(pool, c => activateBranches(c, { order_id: order.id, bindings: [{ branch_id: pending[0].id, odoo_company_id: 2 }] }))).rejects.toMatchObject({ code: 'branch_not_pending' })
    await expect(applyReceipt(pool, { order_id: order.id, receipt: { order_id: order.id, tenant_id: customer, target_revision_id: order.target_revision_id, observed_entitlement_digest: quote.entitlement_digest, observed_at: new Date().toISOString(), branch_bindings: [] } })).rejects.toThrow('tenant_required')
    await pool.query("UPDATE orders SET payment_state='paid' WHERE id=$1", [order.id])
    await pool.query("INSERT INTO commercial_outbox(id,kind,aggregate_id,dedupe_key) VALUES($1,'fulfillment.enqueue',$2,$3)", [randomUUID(), order.id, order.target_revision_id])
    expect(await process()).toContainEqual({ order_id: order.id, reason: 'enrollment_pending' })
    const tenant = (await pool.query('SELECT tenant_id FROM subscriptions WHERE id=$1', [order.subscription_id])).rows[0].tenant_id
    expect(tenant).toEqual(expect.any(String))
    expect((await pool.query('SELECT tenant_id,state FROM commercial_branches WHERE subscription_id=$1', [order.subscription_id])).rows).toEqual(Array.from({ length: 3 }, () => ({ tenant_id: tenant, state: 'pending' })))
    await process()
    expect((await pool.query('SELECT tenant_id FROM commercial_branches WHERE subscription_id=$1', [order.subscription_id])).rows).toEqual(Array.from({ length: 3 }, () => ({ tenant_id: tenant })))
  })
  it('accepts optional enrollment identity and rejects malformed administrator email',async()=>{
    const api=async(_method:string,_path:string,body:unknown)=>{
      try{const r=await routesB(pool,{method:'POST',pathname:'/v1/commercial/customers',search:'',issuer:'test',actor:7,capabilities:['vendor.tenants.manage','vendor.subscriptions.manage'],raw:JSON.stringify(body)},new URL('http://localhost/v1/commercial/customers'));return {status:r!.status,body:r!.data}}
      catch(e){return {status:(e as {status:number}).status}}
    }
    const created=await api('POST','/customers',{name:'HTTP enrollment',admin_name:'Admin',admin_login:'admin@example.test'})
    expect(created).toMatchObject({status:201,body:{admin_name:'Admin',admin_login:'admin@example.test',enrollment_request_id:null}})
    expect(await api('POST','/customers',{name:'Bad email',admin_login:'not-email'})).toMatchObject({status:422})
    expect(await api('POST','/customers',{name:'Legacy customer'})).toMatchObject({status:201,body:{admin_login:null}})
  })
  it('a forged HTTP-shaped commercial service actor has no enrollment authority',async()=>{
    const {requireOnboardingAuthority}=await import('../shared/onboarding.js')
    const c=await pool.connect()
    try{await expect(requireOnboardingAuthority(c,{issuer:`${config.installationId}:commercial-fulfillment`,actorUid:1})).rejects.toThrow('shared_onboarding_forbidden')}finally{c.release()}
  })
  async function enrolledJob(payment = 'paid') {
    const s = await seed(true, payment)
    await process()
    const row = (await pool.query('SELECT j.* FROM shared_jobs j JOIN subscriptions s ON s.tenant_id=j.control_tenant_id WHERE s.id=$1', [s.subscription])).rows[0]
    // Isolate dispatcher selection without changing any authorization predicate.
    const scoped = { connect: pool.connect.bind(pool), query: (sql: string) => pool.query(sql.startsWith('SELECT queued.id') ? sql.replace("WHERE queued.state='queued'", `WHERE queued.id='${row.id}' AND queued.state='queued'`) : sql) } as unknown as Pool
    return { ...s, row, scoped }
  }
  it.each(['paid', 'not_required'])('dispatches %s commercial service provision without vendor membership', async payment => {
    const { dispatchSharedOnce } = await import('../shared/job-dispatcher.js')
    const s = await enrolledJob(payment)
    const observe = vi.fn(async () => ({ state: 'unknown' })), applyFenced = vi.fn()
    expect(await dispatchSharedOnce(s.scoped, { observe, applyFenced })).toMatchObject({ state: 'needs_intervention' })
    expect(observe).toHaveBeenCalled(); expect(applyFenced).not.toHaveBeenCalled()
    expect((await pool.query('SELECT attempt_id FROM shared_jobs WHERE id=$1', [s.row.id])).rows[0].attempt_id).not.toBeNull()
  })
  it.each(['unpaid', 'cancelled', 'unlinked'])('does not dispatch %s service enrollment and direct claim quarantines it', async invalid => {
    const { dispatchSharedOnce } = await import('../shared/job-dispatcher.js')
    const { runSharedJob } = await import('../shared/job-worker.js')
    const s = await enrolledJob()
    if (invalid === 'cancelled') await pool.query('UPDATE orders SET cancelled=true WHERE id=$1', [s.order])
    else if (invalid === 'unlinked') await pool.query('UPDATE customers SET enrollment_request_id=NULL WHERE id=$1', [s.customer])
    else await pool.query("UPDATE orders SET payment_state='refunded' WHERE id=$1", [s.order])
    const observe = vi.fn(), applyFenced = vi.fn()
    expect(await dispatchSharedOnce(s.scoped, { observe, applyFenced })).toEqual({ state: 'idle' })
    expect(await runSharedJob(pool, s.row.id, { observe, applyFenced })).toEqual({ state: 'needs_intervention', reason: 'enrollment_authority_invalid' })
    expect(observe).not.toHaveBeenCalled(); expect(applyFenced).not.toHaveBeenCalled()
    expect((await pool.query('SELECT state FROM shared_jobs WHERE id=$1', [s.row.id])).rows[0].state).toBe('needs_intervention')
  })
  it('quarantines commercial authority revoked after claim before an effect', async () => {
    const { runSharedJob } = await import('../shared/job-worker.js')
    const s = await enrolledJob(), applyFenced = vi.fn()
    expect(await runSharedJob(pool, s.row.id, { observe: async () => { await pool.query('UPDATE orders SET cancelled=true WHERE id=$1', [s.order]); return { state: 'absent' } }, applyFenced })).toEqual({ state: 'needs_intervention', reason: 'enrollment_authority_invalid' })
    expect(applyFenced).not.toHaveBeenCalled()
    expect((await pool.query('SELECT state FROM shared_jobs WHERE id=$1', [s.row.id])).rows[0].state).toBe('needs_intervention')
  })
  it('missing administrator stays pending with an actionable enrollment reason', async () => {
    const s = await seed(false)
    expect(await process()).toContainEqual({ order_id: s.order, reason: 'enrollment_admin_missing' })
    expect((await pool.query('SELECT status,payload FROM commercial_outbox WHERE aggregate_id=$1', [s.order])).rows[0]).toMatchObject({ status: 'pending', payload: { reason: 'tenant_required', enrollment_reason: 'enrollment_admin_missing' } })
  })
  it('does not reserve a tenant for an unreleased order', async () => {
    const s = await seed(true, 'awaiting_payment')
    expect(await process()).toContainEqual({ order_id: s.order, reason: 'order_not_released' })
    expect((await pool.query('SELECT enrollment_request_id FROM customers WHERE id=$1', [s.customer])).rows[0].enrollment_request_id).toBeNull()
  })
})
