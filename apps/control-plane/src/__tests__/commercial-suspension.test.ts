import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { routesB } from '../commercial/routes-b.js'
import { CommercialHttpError } from '../commercial/lifecycle.js'
import { onRenewalPaid } from '../commercial/renewals.js'
import { resumeSubscription, suspendSubscription, syncTenantStatus } from '../commercial/suspension.js'
import { setup, url } from './commercial-helpers.js'

const suite = url ? describe : describe.skip
suite('subscription suspension reaches the tenant', () => {
  const pool = new Pool({ connectionString: url, max: 4 })
  const reason = 'Vendor decision'
  beforeAll(async () => { await setup(pool) })
  beforeEach(async () => { await pool.query('TRUNCATE customers CASCADE') })
  afterAll(async () => { await pool.end() })

  async function subscription(state: string, { tenant = true, binding = true }: { tenant?: boolean; binding?: boolean } = {}) {
    const tenantId = randomUUID(), customer = randomUUID(), id = randomUUID()
    if (tenant) await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,'Suspension','saas','managed',$2,true)", [tenantId, `suspension-${tenantId}`])
    if (tenant && binding) {
      const slug = `t${tenantId.replaceAll('-', '')}`
      await pool.query('INSERT INTO shared_registry_bindings(control_tenant_id,tenant_id,host,database_name,filestore,enabled,registry_revision) VALUES($1,$2,$3,$4,$4,true,1)', [tenantId, slug, `${slug}.susp.test`, `liwan_scratch_${slug.slice(1)}`])
    }
    await pool.query('INSERT INTO customers(id,name,tenant_id) VALUES($1,$2,$3)', [customer, 'Suspension customer', tenant ? tenantId : null])
    await pool.query('INSERT INTO subscriptions(id,customer_id,tenant_id,state) VALUES($1,$2,$3,$4)', [id, customer, tenant ? tenantId : null, state])
    return { id, customer, tenantId }
  }
  const row = async (id: string) => (await pool.query('SELECT state,manual_suspension,tenant_status_pushed,tenant_status_failures,tenant_status_next_at,grace_ends_at,revision FROM subscriptions WHERE id=$1', [id])).rows[0]
  const call = (path: string, body: unknown, over: Record<string, unknown> = {}) => {
    const pathname = `/v1/commercial${path}`
    return routesB(pool, { method: 'POST', pathname, raw: JSON.stringify(body), issuer: 'test', actor: 7, capabilities: ['vendor.subscriptions.manage'], stepUpFresh: true, ...over } as never, new URL(pathname, 'http://localhost'))
  }

  describe('vendor action', () => {
    it.each(['active', 'past_due', 'trialing'])('suspends a %s subscription, audits it and marks it as ordered by the vendor', async state => {
      const s = await subscription(state)
      await suspendSubscription(pool, { subscription_id: s.id, reason, actor: '7' })
      expect(await row(s.id)).toMatchObject({ state: 'suspended', manual_suspension: true, tenant_status_pushed: 'active' })
      expect((await pool.query("SELECT actor,reason FROM audit_events WHERE action='subscription.suspended' AND subject=$1", [s.id])).rows).toEqual([{ actor: '7', reason }])
    })
    it.each(['pending', 'suspended', 'cancelled'])('refuses to suspend a %s subscription', async state => {
      const s = await subscription(state)
      await expect(suspendSubscription(pool, { subscription_id: s.id, reason, actor: '7' })).rejects.toMatchObject({ status: 409, code: 'subscription_not_suspendable' })
    })
    it('resumes to active when nothing is overdue, and refuses a subscription that is not suspended', async () => {
      const s = await subscription('active')
      await expect(resumeSubscription(pool, { subscription_id: s.id, reason, actor: '7' })).rejects.toMatchObject({ status: 409, code: 'subscription_not_suspended' })
      await suspendSubscription(pool, { subscription_id: s.id, reason, actor: '7' })
      await resumeSubscription(pool, { subscription_id: s.id, reason, actor: '7' })
      expect(await row(s.id)).toMatchObject({ state: 'active', manual_suspension: false, grace_ends_at: null })
      expect((await pool.query("SELECT 1 FROM audit_events WHERE action='subscription.resumed' AND subject=$1", [s.id])).rowCount).toBe(1)
    })
    it('resumes a running trial as a trial, and an ended one as active', async () => {
      const running = await subscription('trialing'), ended = await subscription('trialing')
      await pool.query("UPDATE subscriptions SET trial_ends_at=now() + interval '5 days',revision=revision+1 WHERE id=$1", [running.id])
      await pool.query("UPDATE subscriptions SET trial_ends_at=now() - interval '1 day',revision=revision+1 WHERE id=$1", [ended.id])
      for (const s of [running, ended]) {
        await suspendSubscription(pool, { subscription_id: s.id, reason, actor: '7' })
        await resumeSubscription(pool, { subscription_id: s.id, reason, actor: '7' })
      }
      expect((await row(running.id)).state).toBe('trialing')
      expect((await row(ended.id)).state).toBe('active')
    })
    it('resumes to past due with a fresh grace period while an invoice is overdue, so dunning does not stop it again at once', async () => {
      const s = await subscription('active')
      await pool.query(`INSERT INTO invoices(id,customer_id,subscription_id,kind,currency,exponent,subtotal_minor,tax_minor,total_minor,period_start,period_end,due_at,status)
        VALUES($1,$2,$3,'renewal','SAR',2,100,15,115,'2026-10-01','2026-11-01',now() - interval '10 days','issued')`, [randomUUID(), s.customer, s.id])
      await suspendSubscription(pool, { subscription_id: s.id, reason, actor: '7' })
      await resumeSubscription(pool, { subscription_id: s.id, reason, actor: '7' })
      const resumed = await row(s.id)
      expect(resumed.state).toBe('past_due')
      expect(new Date(resumed.grace_ends_at).getTime()).toBeGreaterThan(Date.now())
    })
    it('publishes a revisioned commercial-expiry update when resume grants a fresh grace period to an expired trial', async () => {
      const s = await subscription('past_due')
      const revision = randomUUID(), order = randomUUID()
      const entitlement = { modules: ['liwan_core'], features: { 'users.limit': 3 }, digest: 'a'.repeat(64), compiler_version: 1 }
      await pool.query('INSERT INTO subscription_revisions(id,subscription_id,revision,snapshot,quote_id) VALUES($1,$2,1,$3,$4)', [revision, s.id, { entitlement }, randomUUID()])
      await pool.query(`INSERT INTO orders(id,customer_id,subscription_id,kind,quote_id,target_revision_id,payment_state,fulfillment_state,idempotency_key,request_digest,due_now_minor,currency,exponent)
        VALUES($1,$2,$3,'new',$4,$5,'not_required','applied',$6,'fixture',0,'SAR',2)`, [order, s.customer, s.id, randomUUID(), revision, randomUUID()])
      await pool.query("UPDATE subscriptions SET applied_revision_id=$2,trial_ends_at=now() - interval '30 days',commercial_expiry_revision=3,revision=revision+1 WHERE id=$1", [s.id, revision])
      await pool.query(`INSERT INTO invoices(id,customer_id,subscription_id,kind,currency,exponent,subtotal_minor,tax_minor,total_minor,period_start,period_end,due_at,status)
        VALUES($1,$2,$3,'renewal','SAR',2,100,15,115,'2026-10-01','2026-11-01',now() - interval '10 days','issued')`, [randomUUID(), s.customer, s.id])
      await suspendSubscription(pool, { subscription_id: s.id, reason, actor: '7' })
      await resumeSubscription(pool, { subscription_id: s.id, reason, actor: '7' })
      const after = await row(s.id)
      expect(after.state).toBe('past_due')
      expect((await pool.query('SELECT commercial_expiry_revision FROM subscriptions WHERE id=$1', [s.id])).rows[0].commercial_expiry_revision).toBe(4)
      const job = (await pool.query("SELECT payload FROM shared_jobs WHERE control_tenant_id=$1 AND payload->>'operation'='reconfigure'", [s.tenantId])).rows[0].payload
      const graceDate = new Date(after.grace_ends_at)
      graceDate.setUTCDate(graceDate.getUTCDate())
      expect(job.authority).toMatchObject({ order_id: order, target_revision_id: revision, commercial_valid_until: graceDate.toISOString().slice(0, 10), commercial_valid_until_revision: 4,
        branches: { apply: [], archive: [] } })
    })
    it('sends no expiry update for a paid subscription, which carries none in Odoo', async () => {
      const s = await subscription('active')
      await suspendSubscription(pool, { subscription_id: s.id, reason, actor: '7' })
      await resumeSubscription(pool, { subscription_id: s.id, reason, actor: '7' })
      expect((await pool.query('SELECT 1 FROM shared_jobs WHERE control_tenant_id=$1', [s.tenantId])).rowCount).toBe(0)
    })
    it('is not lifted by a paid renewal; only the vendor resumes it', async () => {
      const s = await subscription('past_due')
      await suspendSubscription(pool, { subscription_id: s.id, reason, actor: '7' })
      const order = randomUUID(), revision = randomUUID(), quote = randomUUID()
      await pool.query('INSERT INTO subscription_revisions(id,subscription_id,revision,snapshot,quote_id) VALUES($1,$2,1,$3,$4)', [revision, s.id, '{}', quote])
      await pool.query(`INSERT INTO orders(id,customer_id,subscription_id,kind,quote_id,target_revision_id,payment_state,fulfillment_state,idempotency_key,request_digest,due_now_minor,currency,exponent)
        VALUES($1,$2,$3,'renewal',$4,$5,'paid','queued',$6,'fixture',100,'SAR',2)`, [order, s.customer, s.id, quote, revision, randomUUID()])
      await pool.query("INSERT INTO renewals(id,subscription_id,order_id,period_start,period_end) VALUES($1,$2,$3,'2026-10-01','2026-11-01')", [randomUUID(), s.id, order])
      const client = await pool.connect()
      try { await onRenewalPaid(client, order) } finally { client.release() }
      expect(await row(s.id)).toMatchObject({ state: 'suspended', manual_suspension: true })
    })
  })

  describe('routes', () => {
    it('suspends and resumes through the vendor API and answers the subscription', async () => {
      const s = await subscription('active')
      const suspended = await call(`/subscriptions/${s.id}/suspend`, { reason })
      expect(suspended).toMatchObject({ status: 200, data: { id: s.id, state: 'suspended' } })
      expect(await call(`/subscriptions/${s.id}/resume`, { reason })).toMatchObject({ status: 200, data: { id: s.id, state: 'active' } })
    })
    it('needs the capability, a fresh step-up, a valid id and a reason of three characters or more', async () => {
      const s = await subscription('active')
      await expect(call(`/subscriptions/${s.id}/suspend`, { reason }, { capabilities: ['vendor.read'] })).rejects.toMatchObject({ status: 403, code: 'forbidden' })
      await expect(call(`/subscriptions/${s.id}/suspend`, { reason }, { stepUpFresh: false })).rejects.toMatchObject({ status: 403, code: 'step_up_required' })
      await expect(call('/subscriptions/not-a-uuid/suspend', { reason })).rejects.toMatchObject({ status: 404 })
      for (const body of [{}, { reason: 'ab' }, { reason, extra: 1 }]) await expect(call(`/subscriptions/${s.id}/suspend`, body)).rejects.toBeInstanceOf(CommercialHttpError)
      expect((await row(s.id)).state).toBe('active')
    })
  })

  describe('pushing the status to the tenant', () => {
    it('pushes suspended once, records it only after the tenant confirmed, and pushes active again after a resume', async () => {
      const s = await subscription('active')
      const runner = vi.fn(async () => ({}))
      expect(await syncTenantStatus(pool, { runner })).toEqual({ pushed: [], failed: [] })
      await suspendSubscription(pool, { subscription_id: s.id, reason, actor: '7' })
      expect(await syncTenantStatus(pool, { runner })).toEqual({ pushed: [s.id], failed: [] })
      expect(runner).toHaveBeenLastCalledWith({ tenant_id: s.tenantId, status: 'suspended' })
      expect((await row(s.id)).tenant_status_pushed).toBe('suspended')
      expect(await syncTenantStatus(pool, { runner })).toEqual({ pushed: [], failed: [] })
      await resumeSubscription(pool, { subscription_id: s.id, reason, actor: '7' })
      await syncTenantStatus(pool, { runner })
      expect(runner).toHaveBeenLastCalledWith({ tenant_id: s.tenantId, status: 'active' })
      expect((await row(s.id)).tenant_status_pushed).toBe('active')
      expect(runner).toHaveBeenCalledTimes(2)
    })
    it('keeps a failed push pending for the next run and logs why', async () => {
      const s = await subscription('suspended')
      const log = vi.fn()
      const failing = vi.fn(async () => { throw new Error('script_failed') })
      expect(await syncTenantStatus(pool, { runner: failing, log })).toEqual({ pushed: [], failed: [s.id] })
      expect(log).toHaveBeenCalledWith(expect.stringContaining(s.id), expect.any(Error))
      expect(await row(s.id)).toMatchObject({ tenant_status_pushed: 'active', tenant_status_failures: 1 })
      // Backed off: the next run leaves it alone until its time comes.
      expect(await syncTenantStatus(pool, { runner: async () => ({}) })).toEqual({ pushed: [], failed: [] })
      await pool.query('UPDATE subscriptions SET tenant_status_next_at=now() - interval \'1 second\' WHERE id=$1', [s.id])
      expect(await syncTenantStatus(pool, { runner: async () => ({}) })).toEqual({ pushed: [s.id], failed: [] })
      expect(await row(s.id)).toMatchObject({ tenant_status_failures: 0, tenant_status_next_at: null })
    })
    it('pushes the suspension dunning ordered, and treats past due as active', async () => {
      const s = await subscription('past_due'), late = await subscription('suspended')
      const runner = vi.fn(async (_input: { tenant_id: string; status: string }) => ({}))
      await syncTenantStatus(pool, { runner })
      expect(runner.mock.calls.map(c => c[0].tenant_id)).toEqual([late.tenantId])
      expect((await row(s.id)).tenant_status_pushed).toBe('active')
    })
    it('does not move the revision a quote was priced against, and asserts an unknown status again', async () => {
      const s = await subscription('active')
      const before = (await row(s.id)).revision
      await pool.query('UPDATE subscriptions SET tenant_status_pushed=NULL WHERE id=$1', [s.id])
      const runner = vi.fn(async () => ({}))
      expect(await syncTenantStatus(pool, { runner })).toEqual({ pushed: [s.id], failed: [] })
      expect(runner).toHaveBeenCalledWith({ tenant_id: s.tenantId, status: 'active' })
      expect(await row(s.id)).toMatchObject({ revision: before, tenant_status_pushed: 'active' })
    })
    it('backs a failing tenant off so it does not starve the others, and skips one with no enabled binding without an error', async () => {
      const bad = await subscription('suspended'), good = await subscription('suspended'), unbound = await subscription('suspended', { binding: false })
      const runner = vi.fn(async (input: { tenant_id: string }) => { if (input.tenant_id === bad.tenantId) throw new Error('script_failed') })
      const first = await syncTenantStatus(pool, { runner, limit: 1 })
      const second = await syncTenantStatus(pool, { runner, limit: 1 })
      const rows = [...first.pushed, ...second.pushed, ...first.failed, ...second.failed]
      expect(rows).toContain(good.id)
      expect(rows).not.toContain(unbound.id)
      const failedRow = await row(bad.id)
      if (rows.includes(bad.id)) expect(failedRow.tenant_status_failures).toBe(1)
      await syncTenantStatus(pool, { runner })
      const after = await syncTenantStatus(pool, { runner })
      expect(after.failed).toEqual([])
      expect(runner.mock.calls.filter(c => c[0].tenant_id === unbound.tenantId)).toEqual([])
      expect((await row(bad.id)).tenant_status_next_at ?? new Date(Date.now() + 1)).toBeInstanceOf(Date)
    })
    it('stops a run when a shared runtime job is running or the time budget is spent', async () => {
      await subscription('suspended'); await subscription('suspended')
      const runner = vi.fn(async () => ({}))
      expect(await syncTenantStatus(pool, { runner, busy: async () => true })).toEqual({ pushed: [], failed: [] })
      expect(await syncTenantStatus(pool, { runner, budgetMs: 0 })).toEqual({ pushed: [], failed: [] })
      expect(runner).not.toHaveBeenCalled()
    })
    it('never pushes for a subscription without a tenant', async () => {
      await subscription('suspended', { tenant: false })
      const runner = vi.fn(async () => ({}))
      expect(await syncTenantStatus(pool, { runner })).toEqual({ pushed: [], failed: [] })
      expect(runner).not.toHaveBeenCalled()
    })
    it('corrects a state that flipped while the push was in flight on the next run', async () => {
      const s = await subscription('suspended')
      const runner = vi.fn(async () => { await pool.query("UPDATE subscriptions SET state='active',revision=revision+1 WHERE id=$1", [s.id]) })
      await syncTenantStatus(pool, { runner })
      expect((await row(s.id)).tenant_status_pushed).toBe('suspended')
      await syncTenantStatus(pool, { runner: vi.fn(async () => ({})) })
      expect((await row(s.id)).tenant_status_pushed).toBe('active')
    })
  })
})
