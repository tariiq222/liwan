import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { signServiceRequest } from '@liwan/commercial-contracts/server'
import type { Principal } from '@liwan/commercial-contracts'
import { setup, client, money, monthly, url } from './commercial-helpers.js'
import { acceptQuote, cancelOrder } from '../commercial/orders.js'
import { createQuoteForCustomer } from '../commercial/quotes.js'
import { customerHttp } from '../commercial/customer-http.js'
import { applyReceipt, processFulfillmentOutbox } from '../commercial/fulfillment.js'
import { getSubscription } from '../commercial/subscriptions.js'
import { listBranches } from '../commercial/branches.js'

const suite = url ? describe : describe.skip
suite('restoring an archived branch is a priced order, end to end', () => {
  const pool = new Pool({ connectionString: url, max: 6 })
  const api = client(pool)
  const config = { installationId: 'restore-vendor', key: 'vendor-test-key-'.repeat(4), customerCommercialIssuer: 'restore-customer', customerCommercialServiceKey: 'customer-test-key-'.repeat(4) } as never
  const vendor = { actor_id: '7', kind: 'vendor', customer_id: null, tenant_id: null, capabilities: ['vendor.subscriptions.manage'] } as unknown as Principal
  let plan: { id: string }

  beforeAll(async () => {
    const { version } = await setup(pool)
    await api('POST', '/catalog/releases', { catalog_version: version, reason: 'Branch restore' })
    const created = await api('POST', '/plans', { name: `Restore ${randomUUID()}`, audience: { kind: 'public' }, term_months: 12, currency: 'SAR', prices: [{ cadence: monthly, amount: money(10000) }],
      platform_limits: {}, included_bundle_revision_ids: [], optional_bundle_revision_ids: [], included_extra_branches: 1, extra_branch_prices: [{ cadence: monthly, amount: money(5000) }],
      extra_branches_limit: 2, included_users: 1, included_storage_mb: 0, user_prices: [{ cadence: monthly, amount: money(0) }], storage_prices: [{ cadence: monthly, amount: money(0) }],
      policy_revision_id: '6f1c3d8e-0000-4000-8000-000000000001', trial_days: 0, grace_days: 2, auto_suspend: true, auto_renew_allowed: true })
    const validated = await api('POST', `/plans/${created.body.id}/validate`, { edit_revision: 1, reason: 'Branch restore' })
    plan = (await api('POST', `/plans/${created.body.id}/publish`, { edit_revision: validated.body.edit_revision, reason: 'Branch restore' })).body
  })
  afterAll(async () => { await pool.end() })

  /** A running customer with a tenant: HQ, one free and one paid extra branch, the paid one ('Branch 2') archived. */
  async function scenario() {
    const tenant = randomUUID(), customer = randomUUID(), slug = `t${tenant.replaceAll('-', '')}`
    await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,'Restore','saas','managed',$2,true)", [tenant, slug])
    await pool.query('INSERT INTO shared_registry_bindings(control_tenant_id,tenant_id,host,database_name,filestore,enabled,registry_revision) VALUES($1,$2,$3,$4,$4,true,1)', [tenant, slug, `${slug}.restore.test`, `liwan_scratch_${tenant.replaceAll('-', '')}`])
    await pool.query('INSERT INTO customers(id,name,tenant_id) VALUES($1,$2,$3)', [customer, 'Restore customer', tenant])
    const quote = await createQuoteForCustomer(pool, { customer_id: customer, request: { kind: 'new', plan_revision_id: plan.id, bundle_revision_ids: [], cadence: monthly, requested_extra_branches: 2, requested_users: 1, requested_storage_mb: 0 } })
    const { order } = await acceptQuote(pool, { quote_id: quote.id, expected_subscription_revision: 0, idempotency_key: randomUUID() }, vendor)
    await pool.query("UPDATE orders SET payment_state='paid',fulfillment_state='applied' WHERE id=$1", [order.id])
    await pool.query("UPDATE invoices SET status='paid',paid_at=now() WHERE order_id=$1", [order.id])
    await pool.query("UPDATE subscriptions SET applied_revision_id=target_revision_id,target_revision_id=NULL,state='active',renewal_at='2026-12-01',revision=revision+1 WHERE id=$1", [order.subscription_id])
    await pool.query("INSERT INTO commercial_branches(id,subscription_id,tenant_id,name,kind,billing,state,odoo_company_id) VALUES($1,$2,$3,'HQ','hq','included','active',10)", [randomUUID(), order.subscription_id, tenant])
    await pool.query("UPDATE commercial_branches SET state='active',odoo_company_id=11 WHERE subscription_id=$1 AND name='Branch 1'", [order.subscription_id])
    await pool.query("UPDATE commercial_branches SET odoo_company_id=12 WHERE subscription_id=$1 AND name='Branch 2'", [order.subscription_id])
    const principal = { actor_id: '7', kind: 'customer', customer_id: customer, tenant_id: tenant, capabilities: ['subscription.manage', 'branches.manage'] } as unknown as Principal
    // Archive 'Branch 2' the real way (a branch_archive order, no money due), so the applied snapshot counts one extra branch.
    const base = { tenant }
    const toArchive = (await listBranches(pool, order.subscription_id)).items.find(b => b.name === 'Branch 2')!
    const archiveQuote = (await route(base, '/v1/customer/branch-quotes', { archive: [toArchive.id] })).data
    const archiveOrder = (await acceptQuote(pool, { quote_id: archiveQuote.id, expected_subscription_revision: archiveQuote.expected_subscription_revision, idempotency_key: randomUUID() }, principal)).order
    await pool.query("UPDATE orders SET fulfillment_state='applied' WHERE id=$1", [archiveOrder.id])
    await pool.query("UPDATE subscriptions SET applied_revision_id=target_revision_id,target_revision_id=NULL,revision=revision+1 WHERE id=$1", [order.subscription_id])
    await pool.query("UPDATE commercial_branches SET state='archived',archived_at=now() WHERE id=$1", [toArchive.id])
    const branches = (await listBranches(pool, order.subscription_id)).items
    return { tenant, customer, subscription: order.subscription_id as string, active: branches.find(b => b.name === 'Branch 1')!, archived: branches.find(b => b.name === 'Branch 2')!, principal }
  }
  /** The signed customer route, as the web server calls it. */
  async function route(s: { tenant: string }, path: string, body: unknown, capabilities = ['branches.manage']) {
    const raw = JSON.stringify(body)
    const header = Buffer.from(JSON.stringify({ actor_id: '7', kind: 'customer', tenant_id: s.tenant, capabilities })).toString('base64')
    const signed = signServiceRequest({ method: 'POST', path, body: `liwan-principal:${header}\n${raw}`, actor: 7, issuer: 'restore-customer', key: 'customer-test-key-'.repeat(4) })
    return await customerHttp(pool, config, { method: 'POST', path, raw, headers: { ...signed, 'x-liwan-principal': header, 'content-type': 'application/json' } as never }) as { status: number; data: any }
  }
  const quoteRestore = async (s: Awaited<ReturnType<typeof scenario>>, ids: string[]) => route(s, '/v1/customer/branch-quotes', { restore: ids })

  it('quotes a restore through the customer route: a paid slot again, and only for a branches manager', async () => {
    const s = await scenario()
    const quoted = await quoteRestore(s, [s.archived.id])
    expect(quoted.status).toBe(201)
    expect(quoted.data.requested_extra_branches).toBe(2)
    expect(quoted.data.due_now.minor).toBeGreaterThan(0)
    expect((await pool.query('SELECT adds,archive,restore,quoted_paid FROM branch_quote_requests WHERE quote_id=$1', [quoted.data.id])).rows[0]).toEqual({ adds: [], archive: [], restore: [s.archived.id], quoted_paid: 1 })
    await expect(route(s, '/v1/customer/branch-quotes', { restore: [s.archived.id] }, ['subscription.manage'])).rejects.toMatchObject({ status: 403 })
  })

  it('refuses at the route: an active branch, an unknown one, a mixed request, a taken name, and the extra-branch limit', async () => {
    const s = await scenario()
    await expect(quoteRestore(s, [s.active.id])).rejects.toMatchObject({ status: 409, code: 'branch_not_archived' })
    await expect(quoteRestore(s, [randomUUID()])).rejects.toMatchObject({ status: 404, code: 'branch_not_found' })
    await expect(route(s, '/v1/customer/branch-quotes', { restore: [s.archived.id], add: [{ name: 'Other' }] })).rejects.toMatchObject({ status: 422, code: 'mixed_branch_change_unsupported' })
    await pool.query("INSERT INTO commercial_branches(id,subscription_id,tenant_id,name,kind,billing,state) VALUES($1,$2,$3,'branch 2','extra','paid','active')", [randomUUID(), s.subscription, s.tenant])
    await expect(quoteRestore(s, [s.archived.id])).rejects.toMatchObject({ status: 409, code: 'branch_name_taken' })
    // The plan allows two extra branches: with both slots taken by active branches a restore goes over the limit.
    const t = await scenario()
    await pool.query("INSERT INTO commercial_branches(id,subscription_id,tenant_id,name,kind,billing,state) VALUES($1,$2,$3,'Third','extra','paid','active')", [randomUUID(), t.subscription, t.tenant])
    await expect(quoteRestore(t, [t.archived.id])).rejects.toMatchObject({ code: 'branch_limit_exceeded' })
  })

  it('accepting the quote creates a branch_restore order, pins the restore in the snapshot and reserves the branch', async () => {
    const s = await scenario()
    const quote = (await quoteRestore(s, [s.archived.id])).data
    const { order } = await acceptQuote(pool, { quote_id: quote.id, expected_subscription_revision: quote.expected_subscription_revision, idempotency_key: randomUUID() }, s.principal)
    expect(order).toMatchObject({ kind: 'branch_restore', payment_state: 'awaiting_payment' })
    const snapshot = (await pool.query('SELECT snapshot FROM subscription_revisions WHERE id=$1', [order.target_revision_id])).rows[0].snapshot
    expect(snapshot).toMatchObject({ branch_archive_ids: [], branch_restore_ids: [s.archived.id], extra_branch_count: 2 })
    expect((await listBranches(pool, s.subscription)).items.find(b => b.id === s.archived.id)).toMatchObject({ state: 'pending', odoo_company_id: 12, archived_at: null, order_id: order.id, billing: 'paid' })
    // The customer view never shows the pinned lists.
    expect(Object.keys((await getSubscription(pool, s.customer)).target ?? {})).not.toContain('branch_restore_ids')
    // A resent accept replays the order and reserves nothing twice.
    expect((await acceptQuote(pool, { quote_id: quote.id, expected_subscription_revision: quote.expected_subscription_revision, idempotency_key: (await pool.query('SELECT idempotency_key FROM orders WHERE id=$1', [order.id])).rows[0].idempotency_key }, s.principal)).replay).toBe(true)
  })

  it('a paid restore reaches Odoo as a restore (not a create), and the receipt activates the same company', async () => {
    const s = await scenario()
    const quote = (await quoteRestore(s, [s.archived.id])).data
    const { order } = await acceptQuote(pool, { quote_id: quote.id, expected_subscription_revision: quote.expected_subscription_revision, idempotency_key: randomUUID() }, s.principal)
    await pool.query("UPDATE orders SET payment_state='paid',fulfillment_state='queued' WHERE id=$1", [order.id])
    await pool.query("UPDATE invoices SET status='paid',paid_at=now() WHERE order_id=$1", [order.id])
    await pool.query("INSERT INTO commercial_outbox(id,kind,aggregate_id,dedupe_key,payload) VALUES($1,'fulfillment.enqueue',$2,$3,$4)", [randomUUID(), order.id, order.target_revision_id, { order_id: order.id }])
    await processFulfillmentOutbox(pool, { limit: 1000 })
    const job = (await pool.query('SELECT payload FROM shared_jobs WHERE control_tenant_id=$1', [s.tenant])).rows[0].payload
    expect(job.authority.branches).toEqual({ apply: [], archive: [], restore: [s.archived.id] })
    const digest = (await pool.query('SELECT snapshot FROM subscription_revisions WHERE id=$1', [order.target_revision_id])).rows[0].snapshot.entitlement.digest
    const database = job.binding.database
    await applyReceipt(pool, { order_id: order.id, receipt: { order_id: order.id, tenant_id: database, database, target_revision_id: order.target_revision_id, observed_entitlement_digest: digest,
      observed_at: new Date().toISOString(), branch_bindings: [{ branch_id: s.archived.id, odoo_company_id: 12 }], modules_installed: [] } as never })
    expect((await listBranches(pool, s.subscription)).items.find(b => b.id === s.archived.id)).toMatchObject({ state: 'active', odoo_company_id: 12 })
    expect((await pool.query('SELECT fulfillment_state FROM orders WHERE id=$1', [order.id])).rows[0].fulfillment_state).toBe('applied')
    expect((await pool.query('SELECT applied_revision_id,target_revision_id FROM subscriptions WHERE id=$1', [s.subscription])).rows[0]).toEqual({ applied_revision_id: order.target_revision_id, target_revision_id: null })
  })

  it('cancelling the unpaid restore order puts the branch back to archived, and it can be restored again', async () => {
    const s = await scenario()
    const first = (await quoteRestore(s, [s.archived.id])).data
    const { order } = await acceptQuote(pool, { quote_id: first.id, expected_subscription_revision: first.expected_subscription_revision, idempotency_key: randomUUID() }, s.principal)
    await cancelOrder(pool, { order_id: order.id, principal: vendor, reason: 'Customer changed their mind' })
    expect((await listBranches(pool, s.subscription)).items.find(b => b.id === s.archived.id)).toMatchObject({ state: 'archived', odoo_company_id: 12 })
    const second = await quoteRestore(s, [s.archived.id])
    expect(second.status).toBe(201)
  })

  it('a restore that went stale between quote and order is refused with requote_required and reserves nothing', async () => {
    const s = await scenario()
    const quote = (await quoteRestore(s, [s.archived.id])).data
    // The paid count the quote assumed moved: another extra branch became active in the meantime.
    await pool.query("INSERT INTO commercial_branches(id,subscription_id,tenant_id,name,kind,billing,state) VALUES($1,$2,$3,'Late branch','extra','paid','active')", [randomUUID(), s.subscription, s.tenant])
    await expect(acceptQuote(pool, { quote_id: quote.id, expected_subscription_revision: quote.expected_subscription_revision, idempotency_key: randomUUID() }, s.principal)).rejects.toMatchObject({ code: 'requote_required' })
    expect((await listBranches(pool, s.subscription)).items.find(b => b.id === s.archived.id)).toMatchObject({ state: 'archived' })
  })
})
