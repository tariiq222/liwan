import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { sharedReconfigureJobSchema, type SharedReconfigureJob } from '@liwan/commercial-contracts/shared'
import { recoverPaidFulfillment } from '../commercial/paid-fulfillment-recovery.js'
import { refundCreditNote } from '../commercial/settlements.js'
import { transaction } from '../db.js'
import { recoverableTrialPredecessors } from '../shared/commercial-recovery.js'
import { enqueueReconfigureJob } from '../shared/job-store.js'
import { assertReconfigureAuthority } from '../shared/subscription-reconfigure.js'
import { setup, url } from './commercial-helpers.js'

const suite = url ? describe : describe.skip
const cutoff = '2026-11-19T09:00:00.000Z'
const beforeCutoff = '2026-11-18T09:00:00.000Z'
const recoveryTime = new Date('2030-01-01T00:00:00Z')
const policy = (digest: string) => ({ modules: ['liwan_core'], features: { 'users.limit': 3, 'storage.limit_mb': 0, 'branches.extra_limit': 0 }, digest, compiler_version: 1 })

suite('trial delivery recovery with durable predecessor and binding authority', () => {
  const pool = new Pool({ connectionString: url })
  beforeAll(async () => { await setup(pool) })
  afterAll(async () => { await pool.end() })

  async function fixture() {
    const tenant = randomUUID(), customer = randomUUID(), subscription = randomUUID(), applied = randomUUID()
    const tenantId = 't' + tenant.replaceAll('-', '')
    const database = 'liwan_scratch_' + tenant.replaceAll('-', '')
    const host = tenantId + '.test'
    await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,'Trial recovery','saas','shared_managed',$2,true)", [tenant, tenantId])
    await pool.query("INSERT INTO shared_registry_bindings(control_tenant_id,tenant_id,host,database_name,filestore,enabled,registry_revision) VALUES($1,$2,$3,$4,$4,true,1)", [tenant, tenantId, host, database])
    await pool.query("INSERT INTO customers(id,name,tenant_id,admin_name,admin_login) VALUES($1,'Trial recovery',$2,'Manager',$3)", [customer, tenant, customer + '@example.test'])
    await pool.query("INSERT INTO subscriptions(id,customer_id,tenant_id,state,trial_ends_at) VALUES($1,$2,$3,'trialing',$4)", [subscription, customer, tenant, cutoff])
    await pool.query('INSERT INTO subscription_revisions(id,subscription_id,revision,snapshot,quote_id) VALUES($1,$2,1,$3,$4)', [applied, subscription, { entitlement: policy('a'.repeat(64)) }, randomUUID()])
    await pool.query('UPDATE subscriptions SET applied_revision_id=$2,revision=revision+1 WHERE id=$1', [subscription, applied])
    return { tenant, customer, subscription, applied, binding: { tenantId, database, filestore: database, registryRevision: 1 }, host }
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>

  async function order(f: Fixture, options: {
    prefix: string; revision: number; digit: string; paid?: boolean; journal?: 'possible'|'prewrite'; branch?: boolean; plain?: boolean; provider?: string
  }) {
    const orderId = randomUUID(), target = randomUUID(), operation = randomUUID(), quote = randomUUID()
    const entitlement = policy(options.digit.repeat(64))
    await pool.query('INSERT INTO subscription_revisions(id,subscription_id,revision,snapshot,quote_id) VALUES($1,$2,$3,$4,$5)', [target, f.subscription, options.revision, { entitlement }, quote])
    await pool.query(`INSERT INTO orders(id,customer_id,subscription_id,kind,quote_id,target_revision_id,expected_applied_revision_id,
      payment_state,fulfillment_state,idempotency_key,request_digest,due_now_minor,currency,exponent,created_at,
      fulfillment_retries,fulfillment_failure_code) VALUES($1,$2,$3,'change',$4,$5,$6,$7,$8,$9,'fixture',$10,'SAR',2,$11,3,$12)`,
    [orderId, f.customer, f.subscription, quote, target, f.applied, options.paid ? 'paid' : 'not_required',
      options.journal ? 'needs_intervention' : 'queued', `${options.prefix}:${f.subscription}:${options.revision}`,
      options.paid ? 100 : 0, beforeCutoff, options.journal === 'prewrite' ? 'tenant_binding_mismatch' : 'observed_mismatch'])
    const job: SharedReconfigureJob = {
      schemaVersion: 1, operation: 'reconfigure', requestId: operation, controlTenantId: f.tenant, host: f.host, binding: f.binding,
      ...(options.prefix === 'trial-lapse' ? { origin: 'trial-end' as const } : {}),
      authority: {
        order_id: orderId, operation_id: operation, previous_revision_id: f.applied, target_revision_id: target, entitlement,
        branches: { apply: [], archive: options.branch ? [randomUUID()] : [] },
        ...(options.plain ? {} : options.prefix === 'trial-lapse' ? { trial_ends_at: null, excess_settle: true as const } : {
          trial_ends_at: cutoff, post_trial_features: entitlement.features, post_trial_modules: entitlement.modules, post_trial_digest: 'e'.repeat(64),
        }),
      },
    }
    const queued = await transaction(pool, tx => enqueueReconfigureJob(tx, job))
    await pool.query('INSERT INTO fulfillment_effects(id,order_id,job_id,operation_id) VALUES($1,$2,$3,$4)', [randomUUID(), orderId, queued.id, operation])
    if (options.journal) await pool.query("UPDATE shared_jobs SET state='needs_intervention',journal=$2 WHERE id=$1", [queued.id,
      { stage: 'needs_intervention', operation_id: operation, may_have_written: options.journal === 'possible',
        error_code: options.journal === 'possible' ? 'observed_mismatch' : 'tenant_binding_mismatch' }])
    if (options.paid) {
      const invoice = randomUUID(), attempt = randomUUID()
      await pool.query("INSERT INTO invoices(id,customer_id,subscription_id,order_id,kind,status,currency,exponent,subtotal_minor,tax_minor,total_minor,period_start,period_end) VALUES($1,$2,$3,$4,'change','paid','SAR',2,100,0,100,'2026-11-01','2026-12-01')", [invoice, f.customer, f.subscription, orderId])
      await pool.query("INSERT INTO payment_attempts(id,order_id,invoice_id,provider,mode,amount_minor,currency,exponent,status) VALUES($1,$2,$3,$4,$5,100,'SAR',2,'succeeded')", [attempt, orderId, invoice, options.provider ?? 'simulator', options.provider ? 'live' : 'simulator'])
      await pool.query('UPDATE orders SET paid_attempt_id=$2 WHERE id=$1', [orderId, attempt])
    }
    return { orderId, target, job, jobId: queued.id }
  }

  const target = (f: Fixture, id: string) => pool.query('UPDATE subscriptions SET target_revision_id=$2,revision=revision+1 WHERE id=$1', [f.subscription, id])
  const state = async (id: string) => (await pool.query('SELECT * FROM orders WHERE id=$1', [id])).rows[0]

  it('recognizes only the exact paid abandoned policy and its recorded fallback after refund was queued', async () => {
    const f = await fixture()
    const b = await order(f, { prefix: 'paid-trial-change', revision: 2, digit: 'b', paid: true, journal: 'possible' })
    await target(f, b.target)
    await recoverPaidFulfillment(pool, recoveryTime)
    expect(await state(b.orderId)).toMatchObject({ payment_state: 'refund_pending', cancelled: true })
    const c = await order(f, { prefix: 'trial-lapse', revision: 3, digit: 'c' })
    await target(f, c.target)
    await pool.query("INSERT INTO trial_lapses(subscription_id,trial_revision_id,period_start,ended_at,state,order_id) VALUES($1,$2,'2026-11-19',$3,'ordered',$4)", [f.subscription, f.applied, cutoff, c.orderId])

    const predecessors = await recoverableTrialPredecessors(pool, c.orderId)
    expect(predecessors).toEqual([{ revision_id: b.target, digest: 'b'.repeat(64) }, { revision_id: b.target, digest: 'e'.repeat(64) }])
    const exact = sharedReconfigureJobSchema.parse({ ...c.job, authority: { ...c.job.authority, recoverable_predecessors: predecessors } })
    await expect(transaction(pool, tx => assertReconfigureAuthority(tx, exact))).resolves.toBeUndefined()
    const forged = { ...exact, authority: { ...exact.authority, recoverable_predecessors: [{ revision_id: b.target, digest: 'f'.repeat(64) }] } }
    await expect(transaction(pool, tx => assertReconfigureAuthority(tx, forged))).rejects.toThrow('recovery_predecessor_invalid')
    await pool.query("UPDATE commercial_outbox SET payload=jsonb_set(payload,'{automatic}','false') WHERE kind='reconcile.refund' AND aggregate_id=$1", [b.orderId])
    expect(await recoverableTrialPredecessors(pool, c.orderId)).toEqual([])

    await pool.query("UPDATE shared_jobs SET state='failed' WHERE id=$1", [c.jobId])
    const recorded = await transaction(pool, tx => enqueueReconfigureJob(tx, exact, { unique: true }))
    await pool.query('UPDATE fulfillment_effects SET job_id=$2 WHERE order_id=$1', [c.orderId, recorded.id])
    await pool.query("UPDATE orders SET fulfillment_state='applied' WHERE id=$1", [c.orderId])
    await pool.query('UPDATE subscriptions SET applied_revision_id=$2,target_revision_id=NULL,revision=revision+1 WHERE id=$1', [f.subscription, c.target])
    await pool.query("UPDATE trial_lapses SET state='done' WHERE subscription_id=$1", [f.subscription])
    await expect(transaction(pool, tx => assertReconfigureAuthority(tx, exact))).rejects.toThrow('recovery_predecessor_invalid')
    await pool.query('UPDATE fulfillment_effects SET receipt=$2,observed_digest=$3,applied_at=now() WHERE order_id=$1',
      [c.orderId, { order_id: c.orderId, database: f.binding.database, target_revision_id: c.target,
        observed_entitlement_digest: c.job.authority.entitlement.digest }, c.job.authority.entitlement.digest])
    await expect(transaction(pool, tx => assertReconfigureAuthority(tx, exact))).resolves.toBeUndefined()
    await expect(transaction(pool, tx => assertReconfigureAuthority(tx, forged))).rejects.toThrow('recovery_predecessor_invalid')
  })

  it('keeps a possibly written branch order paid and retries only the same effect on its healthy binding', async () => {
    const f = await fixture()
    const b = await order(f, { prefix: 'paid-branches', revision: 2, digit: 'b', paid: true, journal: 'possible', branch: true })
    await target(f, b.target)
    await recoverPaidFulfillment(pool, recoveryTime)
    expect(await state(b.orderId)).toMatchObject({ payment_state: 'paid', cancelled: false, fulfillment_state: 'queued' })
    expect((await pool.query('SELECT job_id,operation_id FROM fulfillment_effects WHERE order_id=$1', [b.orderId])).rows[0])
      .toMatchObject({ job_id: b.jobId, operation_id: b.job.authority.operation_id })
    expect((await pool.query('SELECT target_revision_id FROM subscriptions WHERE id=$1', [f.subscription])).rows[0].target_revision_id).toBe(b.target)
    expect((await pool.query("SELECT 1 FROM commercial_outbox WHERE aggregate_id=$1 AND kind='reconcile.refund'", [b.orderId])).rowCount).toBe(0)
  })

  it('fences a possible write on a stale binding without requeueing or refunding it', async () => {
    const f = await fixture()
    const b = await order(f, { prefix: 'paid-branches', revision: 2, digit: 'b', paid: true, journal: 'possible', branch: true })
    await target(f, b.target)
    await pool.query('UPDATE shared_registry_bindings SET registry_revision=2 WHERE control_tenant_id=$1', [f.tenant])
    await recoverPaidFulfillment(pool, recoveryTime)
    expect(await state(b.orderId)).toMatchObject({ payment_state: 'paid', cancelled: false, fulfillment_state: 'needs_intervention' })
    expect((await pool.query('SELECT state FROM shared_jobs WHERE id=$1', [b.jobId])).rows[0].state).toBe('needs_intervention')
    expect((await pool.query('SELECT target_revision_id FROM subscriptions WHERE id=$1', [f.subscription])).rows[0].target_revision_id).toBe(b.target)
    expect((await pool.query("SELECT 1 FROM commercial_outbox WHERE aggregate_id=$1 AND kind='reconcile.refund'", [b.orderId])).rowCount).toBe(0)
  })

  it('keeps a possibly written paid non-trial policy change fenced instead of refunding the revision Odoo may hold', async () => {
    const f = await fixture()
    const b = await order(f, { prefix: 'paid-change', revision: 2, digit: 'b', paid: true, journal: 'possible', plain: true })
    await target(f, b.target)
    await recoverPaidFulfillment(pool, recoveryTime)
    expect(await state(b.orderId)).toMatchObject({ payment_state: 'paid', cancelled: false, fulfillment_state: 'queued' })
    expect((await pool.query('SELECT target_revision_id FROM subscriptions WHERE id=$1', [f.subscription])).rows[0].target_revision_id).toBe(b.target)
    expect((await pool.query("SELECT 1 FROM commercial_outbox WHERE aggregate_id=$1 AND kind='reconcile.refund'", [b.orderId])).rowCount).toBe(0)
  })

  it('lets an operator settle a bank-transfer order left in refund_pending by recording the credit note refund', async () => {
    const f = await fixture()
    const b = await order(f, { prefix: 'paid-trial-change', revision: 2, digit: 'b', paid: true, journal: 'possible', provider: 'bank_transfer' })
    await target(f, b.target)
    await recoverPaidFulfillment(pool, recoveryTime)
    expect(await state(b.orderId)).toMatchObject({ payment_state: 'refund_pending', cancelled: true })
    const note = (await pool.query("SELECT ia.id FROM invoice_adjustments ia JOIN invoices i ON i.id=ia.invoice_id WHERE i.order_id=$1 AND ia.status='pending'", [b.orderId])).rows[0]
    await refundCreditNote(pool, { adjustment_id: note.id, actor: { issuer: 'vendor-test', actorUid: 7 }, request: { external_reference: 'BANK-OUT-1', reason: 'Returned by bank transfer' } })
    expect((await state(b.orderId)).payment_state).toBe('refunded')
    expect((await pool.query("SELECT status FROM commercial_outbox WHERE aggregate_id=$1 AND kind='reconcile.refund'", [b.orderId])).rows)
      .toEqual([{ status: 'done' }])
  })

  it.each(['trial-bootstrap','trial-reopen'])('rebinds proven pre-write %s without changing the audited order and cutoff', async prefix => {
    const f = await fixture()
    const a = await order(f, { prefix, revision: 2, digit: 'b', journal: 'prewrite' })
    const audit = randomUUID(), action = prefix === 'trial-reopen' ? 'trial.reopened' : 'trial.policy_bootstrap_queued'
    const metadata = { source_revision_id: f.applied, target_revision_id: a.target, trial_ends_at: cutoff }
    await pool.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)',
      [audit, 'vendor:trial-fixture', action, f.subscription, 'Original audited trial intent', metadata])
    await target(f, a.target)
    await pool.query('UPDATE shared_registry_bindings SET registry_revision=2 WHERE control_tenant_id=$1', [f.tenant])
    await recoverPaidFulfillment(pool, recoveryTime)
    expect(await state(a.orderId)).toMatchObject({ payment_state: 'not_required', cancelled: false, fulfillment_state: 'queued' })
    const linked = (await pool.query('SELECT j.id,j.payload,e.operation_id FROM fulfillment_effects e JOIN shared_jobs j ON j.id=e.job_id WHERE e.order_id=$1', [a.orderId])).rows[0]
    expect(linked.id).not.toBe(a.jobId)
    expect(linked.operation_id).not.toBe(a.job.authority.operation_id)
    expect(linked.payload).toMatchObject({ binding: { registryRevision: 2 }, authority: { order_id: a.orderId, target_revision_id: a.target, trial_ends_at: cutoff, operation_id: linked.operation_id } })
    expect((await pool.query('SELECT state FROM shared_jobs WHERE id=$1', [a.jobId])).rows[0].state).toBe('failed')
    expect((await pool.query('SELECT action,reason,metadata FROM audit_events WHERE id=$1', [audit])).rows[0])
      .toEqual({ action, reason: 'Original audited trial intent', metadata })
  })
})
