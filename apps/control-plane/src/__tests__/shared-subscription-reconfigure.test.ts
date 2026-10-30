import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { migrate } from '../db.js'
import { applyReceipt, processFulfillmentOutbox } from '../commercial/fulfillment.js'

const source = process.env.CONTROL_TEST_DATABASE_URL
// Honor an explicitly isolated scratch DB; never connect to a non-scratch name.
export const scratchUrl = source ? (() => {
  const u = new URL(source)
  if (!['localhost','127.0.0.1','::1'].includes(u.hostname)) throw Error('scratch_required')
  if (!u.pathname || u.pathname === '/') u.pathname = '/liwan_control_scratch_reconfigure'
  if (!/^\/liwan_control_scratch_[a-z0-9]+$/.test(u.pathname)) throw Error('scratch_required')
  return u.toString()
})() : undefined
export async function setupScratch(pool: Pool) {
  await migrate(pool)
  // TODO(B1): register migration 15 centrally; remove fallback once registered.
  if (!(await pool.query("SELECT to_regclass('commercial_branches') AS name")).rows[0].name) await pool.query(await readFile(new URL('../schema_015.sql', import.meta.url), 'utf8'))
}
export async function seedOrder(pool: Pool, tenantRequired = false) {
  const tenant = randomUUID(), customer = randomUUID(), subscription = randomUUID(), previous = randomUUID(), target = randomUUID(), order = randomUUID(), branch = randomUUID()
  const slug = `t${tenant.replaceAll('-','')}`, database = `liwan_scratch_${tenant.replaceAll('-','')}`
  const entitlement = { modules: ['liwan_platform'], features: {'users.limit':10,'storage.limit_mb':100}, digest:'a'.repeat(64),compiler_version:1 }
  await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,'B3','saas','managed',$2,true)", [tenant, slug])
  await pool.query('INSERT INTO shared_registry_bindings(control_tenant_id,tenant_id,host,database_name,filestore,enabled,registry_revision) VALUES($1,$2,$3,$4,$4,true,1)',[tenant,slug,`${slug}.test`,database])
  await pool.query('INSERT INTO customers(id,name,tenant_id) VALUES($1,\'B3\',$2)',[customer,tenantRequired?null:tenant])
  await pool.query('INSERT INTO subscriptions(id,customer_id,tenant_id) VALUES($1,$2,$3)',[subscription,customer,tenantRequired?null:tenant])
  for (const [id,revision] of [[previous,1],[target,2]]) await pool.query('INSERT INTO subscription_revisions(id,subscription_id,revision,snapshot,quote_id) VALUES($1,$2,$3,$4,$5)',[id,subscription,revision,{entitlement},randomUUID()])
  await pool.query("UPDATE subscriptions SET applied_revision_id=$2,target_revision_id=$3,state='active',revision=revision+1 WHERE id=$1",[subscription,previous,target])
  await pool.query("INSERT INTO orders(id,customer_id,subscription_id,kind,quote_id,target_revision_id,expected_applied_revision_id,payment_state,fulfillment_state,idempotency_key,request_digest,due_now_minor,currency,exponent) VALUES($1,$2,$3,'change',$4,$5,$6,'paid','queued',$7,'test',100,'SAR',2)",[order,customer,subscription,randomUUID(),target,previous,randomUUID()])
  await pool.query("INSERT INTO commercial_branches(id,subscription_id,tenant_id,name,kind,billing,order_id) VALUES($1,$2,$3,'Extra','extra','paid',$4)",[branch,subscription,tenant,order])
  await pool.query("INSERT INTO commercial_outbox(id,kind,aggregate_id,dedupe_key,payload) VALUES($1,'fulfillment.enqueue',$2,$3,$4)",[randomUUID(),order,target,{order_id:order}])
  const receipt = {order_id:order,tenant_id:database,database,target_revision_id:target,observed_entitlement_digest:entitlement.digest,observed_at:new Date().toISOString(),branch_bindings:[{branch_id:branch,odoo_company_id:2}],modules_installed:[]}
  return {tenant,customer,subscription,previous,target,order,branch,receipt}
}

describe('subscription enqueue contract', () => {
  it('claims only fulfillment.enqueue and returns an empty batch without effects', async () => {
    const { vi } = await import('vitest')
    const query=vi.fn(async (_sql:string, _params?:unknown[]) => ({rows:[]}))
    const fake={connect:async()=>({query,release:()=>{}}),query} as unknown as Pool
    expect(await processFulfillmentOutbox(fake,{limit:10})).toEqual([])
    expect(query.mock.calls.some(c=>String(c[0]).includes('commercial_outbox'))).toBe(true)
  })
})

describe.skipIf(!scratchUrl)('subscription reconfigure integration-fake', () => {
  const pool = new Pool({connectionString:scratchUrl})
  beforeAll(() => setupScratch(pool))
  afterAll(() => pool.end())
  it('paid outbox enqueues exactly once; only the receipt activates service and branches', async () => {
    const s=await seedOrder(pool)
    await processFulfillmentOutbox(pool,{limit:100})
    await processFulfillmentOutbox(pool,{limit:100})
    expect((await pool.query('SELECT * FROM shared_jobs WHERE control_tenant_id=$1',[s.tenant])).rows).toHaveLength(1)
    expect((await pool.query('SELECT applied_revision_id FROM subscriptions WHERE id=$1',[s.subscription])).rows[0].applied_revision_id).toBe(s.previous)
    await applyReceipt(pool,{order_id:s.order,receipt:s.receipt})
    expect((await pool.query('SELECT fulfillment_state FROM orders WHERE id=$1',[s.order])).rows[0].fulfillment_state).toBe('applied')
    expect((await pool.query('SELECT applied_revision_id,target_revision_id FROM subscriptions WHERE id=$1',[s.subscription])).rows[0]).toEqual({applied_revision_id:s.target,target_revision_id:null})
    expect((await pool.query('SELECT state FROM commercial_branches WHERE id=$1',[s.branch])).rows[0].state).toBe('active')
    await applyReceipt(pool,{order_id:s.order,receipt:s.receipt})
  })
  it('digest mismatch is quarantined without changing the applied revision', async () => {
    const s=await seedOrder(pool); await processFulfillmentOutbox(pool,{limit:100})
    await expect(applyReceipt(pool,{order_id:s.order,receipt:{...s.receipt,observed_entitlement_digest:'b'.repeat(64)}})).rejects.toThrow('observed_mismatch')
    expect((await pool.query('SELECT fulfillment_state FROM orders WHERE id=$1',[s.order])).rows[0].fulfillment_state).toBe('needs_intervention')
    expect((await pool.query('SELECT applied_revision_id FROM subscriptions WHERE id=$1',[s.subscription])).rows[0].applied_revision_id).toBe(s.previous)
  })
  it('first activation binds the HQ branch to the observed root company', async () => {
    const s=await seedOrder(pool); await processFulfillmentOutbox(pool,{limit:100})
    await pool.query('UPDATE subscriptions SET applied_revision_id=NULL,revision=revision+1 WHERE id=$1',[s.subscription])
    await applyReceipt(pool,{order_id:s.order,receipt:{...s.receipt,root_company_id:5}})
    expect((await pool.query("SELECT odoo_company_id FROM commercial_branches WHERE subscription_id=$1 AND kind='hq'",[s.subscription])).rows).toEqual([{odoo_company_id:5}])
    expect((await pool.query('SELECT odoo_company_id FROM commercial_branches WHERE id=$1',[s.branch])).rows[0].odoo_company_id).toBe(2)
  })
  it('first activation without the root company is quarantined and creates no HQ branch', async () => {
    for (const root_company_id of [undefined, 0, 1.5]) {
      const s=await seedOrder(pool); await processFulfillmentOutbox(pool,{limit:100})
      await pool.query('UPDATE subscriptions SET applied_revision_id=NULL,revision=revision+1 WHERE id=$1',[s.subscription])
      await expect(applyReceipt(pool,{order_id:s.order,receipt:{...s.receipt,root_company_id}})).rejects.toThrow('observed_mismatch')
      expect((await pool.query('SELECT fulfillment_state FROM orders WHERE id=$1',[s.order])).rows[0].fulfillment_state).toBe('needs_intervention')
      expect((await pool.query("SELECT count(*)::int AS n FROM commercial_branches WHERE subscription_id=$1 AND kind='hq'",[s.subscription])).rows[0].n).toBe(0)
    }
  })
  it('new tenant stays pending with tenant_required', async () => {
    const s=await seedOrder(pool,true); await processFulfillmentOutbox(pool,{limit:100})
    const row=(await pool.query('SELECT status,payload FROM commercial_outbox WHERE aggregate_id=$1',[s.order])).rows[0]
    expect(row.status).toBe('pending'); expect(row.payload.reason).toBe('tenant_required')
  })
})
