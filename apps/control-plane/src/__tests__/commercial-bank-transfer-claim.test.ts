import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { riyadhDate } from '@liwan/commercial-contracts'
import { signServiceRequest } from '@liwan/commercial-contracts/server'
import { setup, client, money, monthly, url } from './commercial-helpers.js'
import { acceptQuote } from '../commercial/orders.js'
import { createQuoteForCustomer } from '../commercial/quotes.js'
import { confirmBankTransfer } from '../commercial/bank-transfer.js'
import { attention } from '../commercial/attention.js'
import { customerHttp } from '../commercial/customer-http.js'
import { getVendorInvoice } from '../commercial/invoices.js'
import { enqueueOutbox, failOutbox, completeOutbox } from '../commercial/outbox.js'

const suite = url ? describe : describe.skip
suite('live PostgreSQL bank transfer claims', () => {
  const pool = new Pool({ connectionString: url, max: 6 }), api = client(pool)
  const vendor: any = { actor_id: '7', kind: 'vendor', customer_id: null, tenant_id: null, capabilities: ['vendor.subscriptions.manage'] }
  const config = { installationId: 'claim-vendor', key: 'vendor-test-key-'.repeat(4), customerCommercialIssuer: 'claim-customer', customerCommercialServiceKey: 'customer-test-key-'.repeat(4), inventoryPath: '', repositoryRoot: '', python: 'python3', stateDir: '' }
  const today = riyadhDate(new Date())
  let plan: any

  beforeAll(async () => {
    const { version } = await setup(pool)
    await api('POST', '/catalog/releases', { catalog_version: version, reason: 'Claim acceptance' })
    const c = await api('POST', '/plans', { name: `Claim ${randomUUID()}`, audience: { kind: 'public' }, term_months: 12, currency: 'SAR', prices: [{ cadence: monthly, amount: money(10000) }], platform_limits: {},
      included_bundle_revision_ids: [], optional_bundle_revision_ids: [], included_extra_branches: 1, extra_branch_prices: [{ cadence: monthly, amount: money(5000) }], extra_branches_limit: null,
      included_users: 1, included_storage_mb: 0, storage_step_mb: 10240, storage_step_threshold_mb: 102400, storage_large_step_mb: 102400, user_prices: [{ cadence: monthly, amount: money(0) }],
      storage_prices: [{ cadence: monthly, amount: money(0) }], policy_revision_id: '6f1c3d8e-0000-4000-8000-000000000002', trial_days: 0, grace_days: 7, auto_suspend: true, auto_renew_allowed: true })
    const v = await api('POST', `/plans/${c.body.id}/validate`, { edit_revision: 1, reason: 'Claim acceptance' })
    plan = (await api('POST', `/plans/${c.body.id}/publish`, { edit_revision: v.body.edit_revision, reason: 'Claim acceptance' })).body
  })
  beforeEach(async () => { await pool.query('TRUNCATE customers CASCADE'); await pool.query('TRUNCATE commercial_outbox') })
  afterAll(async () => { await pool.end() })

  async function unpaid() {
    const customer = randomUUID(), tenant = randomUUID()
    await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,'Customer','saas','dedicated_managed',$2,true)", [tenant, `c-${tenant}`])
    await pool.query('INSERT INTO customers(id,name,tenant_id,admin_name,admin_login) VALUES($1,$2,$3,$4,$5)', [customer, 'Claim customer', tenant, 'Manager', `${customer}@example.test`])
    const quote = await createQuoteForCustomer(pool, { customer_id: customer, request: { kind: 'new', plan_revision_id: plan.id, bundle_revision_ids: [], cadence: monthly, requested_extra_branches: 0, requested_users: 1, requested_storage_mb: 0 } })
    const { order } = await acceptQuote(pool, { quote_id: quote.id, expected_subscription_revision: 0, idempotency_key: randomUUID() }, vendor)
    const invoice = (await pool.query("SELECT * FROM invoices WHERE order_id=$1 AND status='issued'", [order.id])).rows[0]
    return { customer, tenant, order, invoice }
  }
  /** The signed customer route, as the web server calls it. */
  async function route(s: { tenant: string }, method: string, path: string, body?: unknown, capabilities = ['subscription.manage', 'billing.read']) {
    const raw = body === undefined ? '' : JSON.stringify(body)
    const header = Buffer.from(JSON.stringify({ actor_id: '7', kind: 'customer', tenant_id: s.tenant, capabilities })).toString('base64')
    const signed = signServiceRequest({ method, path, body: `liwan-principal:${header}\n${raw}`, actor: 7, issuer: config.customerCommercialIssuer, key: config.customerCommercialServiceKey })
    return await customerHttp(pool, config, { method, path, raw, headers: { ...signed, 'x-liwan-principal': header, 'content-type': 'application/json' } as never }) as { status: number; data: any }
  }
  const claim = (s: { tenant: string }, invoiceId: string, body: unknown, caps?: string[]) => route(s, 'POST', `/v1/customer/invoices/${invoiceId}/bank-transfer-claim`, body, caps)
  const claimsOf = async (invoiceId: string) => (await pool.query('SELECT * FROM bank_transfer_claims WHERE invoice_id=$1', [invoiceId])).rows
  const items = async (kind: string) => (await attention(pool, true)).items.filter(i => i.kind === kind)

  it('records one claim per invoice and a second claim corrects the same row', async () => {
    const s = await unpaid()
    const first = await claim(s, s.invoice.id, { value_date: today, sender_reference: 'Ahmed' })
    expect(first).toMatchObject({ status: 200, data: { value_date: today, sender_reference: 'Ahmed' } })
    const second = await claim(s, s.invoice.id, { value_date: today })
    expect(second.data).toMatchObject({ value_date: today, sender_reference: null, claimed_at: first.data.claimed_at })
    expect(await claimsOf(s.invoice.id)).toHaveLength(1)
    expect((await pool.query('SELECT status FROM invoices WHERE id=$1', [s.invoice.id])).rows[0].status).toBe('issued')
    expect((await pool.query('SELECT payment_state FROM orders WHERE id=$1', [s.order.id])).rows[0].payment_state).toBe('awaiting_payment')
  })
  it('shows the customer its own claim next to the instructions', async () => {
    await pool.query("UPDATE billing_settings SET bank_account_name='Liwan',bank_account_number='123',bank_iban='SA0000000000000000000000' WHERE singleton")
    const s = await unpaid()
    const path = `/v1/customer/invoices/${s.invoice.id}/bank-transfer`
    expect((await route(s, 'GET', path)).data.claim).toBeNull()
    await claim(s, s.invoice.id, { value_date: today })
    expect((await route(s, 'GET', path)).data.claim).toMatchObject({ value_date: today })
    await pool.query("UPDATE billing_settings SET bank_account_name='',bank_account_number='',bank_iban='' WHERE singleton")
  })
  it('refuses a paid or void invoice, another customer, a missing capability and bad dates', async () => {
    const s = await unpaid(), other = await unpaid()
    await expect(claim(s, other.invoice.id, { value_date: today })).rejects.toMatchObject({ status: 404 })
    await expect(claim(s, s.invoice.id, { value_date: today }, ['billing.read'])).rejects.toMatchObject({ status: 403 })
    await expect(claim(s, s.invoice.id, { value_date: '2999-01-01' })).rejects.toMatchObject({ status: 422, code: 'value_date_in_future' })
    await expect(claim(s, s.invoice.id, { value_date: '2000-01-01' })).rejects.toMatchObject({ status: 422, code: 'value_date_before_invoice' })
    await expect(claim(s, s.invoice.id, { value_date: today, reference: 'x' })).rejects.toMatchObject({ status: 422 })
    await pool.query("UPDATE invoices SET status='void' WHERE id=$1", [s.invoice.id])
    await expect(claim(s, s.invoice.id, { value_date: today })).rejects.toMatchObject({ status: 409, code: 'invoice_not_payable' })
    await confirmBankTransfer(pool, { invoice_id: other.invoice.id, operator: 'vendor:7', reference: 'TRF-PAID-1', amount: Number(other.invoice.total_minor), value_date: today })
    await expect(claim(other, other.invoice.id, { value_date: today })).rejects.toMatchObject({ status: 409, code: 'invoice_not_payable' })
    expect(await claimsOf(s.invoice.id)).toHaveLength(0)
  })
  it('lists the claim for the vendor until the transfer is confirmed, and confirming queues one payment notice', async () => {
    const s = await unpaid()
    await claim(s, s.invoice.id, { value_date: today, sender_reference: 'Ahmed' })
    expect(await items('bank_transfer_claimed')).toEqual([expect.objectContaining({ customer_id: s.customer, invoice_id: s.invoice.id, detail: today })])
    expect((await attention(pool, false)).items.filter(i => i.kind === 'bank_transfer_claimed')).toHaveLength(0)
    expect((await getVendorInvoice(pool, s.invoice.id))!.bank_transfer_claim).toMatchObject({ value_date: today, sender_reference: 'Ahmed' })
    // The amount rule is exact: a claim does not loosen it.
    await expect(confirmBankTransfer(pool, { invoice_id: s.invoice.id, operator: 'vendor:7', reference: 'TRF-1', amount: Number(s.invoice.total_minor) - 1, value_date: today }))
      .rejects.toMatchObject({ status: 422, code: 'transfer_amount_mismatch' })
    expect(await items('bank_transfer_claimed')).toHaveLength(1)
    const input = { invoice_id: s.invoice.id, operator: 'vendor:7', reference: 'TRF-1', amount: Number(s.invoice.total_minor), value_date: today }
    await confirmBankTransfer(pool, input)
    await confirmBankTransfer(pool, input)
    expect(await items('bank_transfer_claimed')).toHaveLength(0)
    const notices = (await pool.query("SELECT dedupe_key FROM commercial_outbox WHERE kind='billing.notice' AND payload->>'type'='payment_received'")).rows
    expect(notices).toEqual([{ dedupe_key: `payment_received:${s.invoice.id}` }])
  })
  it('drops the claim from the list when the invoice is voided', async () => {
    const s = await unpaid()
    await claim(s, s.invoice.id, { value_date: today })
    await pool.query("UPDATE invoices SET status='void' WHERE id=$1", [s.invoice.id])
    expect(await items('bank_transfer_claimed')).toHaveLength(0)
  })
  it('lists a failed billing or trial notice until a later one of the same kind goes out', async () => {
    const s = await unpaid()
    const subscription = s.order.subscription_id as string
    for (const kind of ['billing.notice', 'trial.notice']) {
      await enqueueOutbox(pool, { kind, aggregate_id: subscription, dedupe_key: `${kind}:1`, payload: { subscription_id: subscription } })
      const id = (await pool.query('SELECT id FROM commercial_outbox WHERE dedupe_key=$1', [`${kind}:1`])).rows[0].id
      await failOutbox(pool, id, 'no_recipient')
    }
    expect(await items('notice_failed')).toEqual([expect.objectContaining({ customer_id: s.customer, detail: 'no_recipient' })])
    await pool.query("UPDATE commercial_outbox SET created_at=now()-interval '1 hour'")
    for (const kind of ['billing.notice', 'trial.notice']) {
      await enqueueOutbox(pool, { kind, aggregate_id: subscription, dedupe_key: `${kind}:2`, payload: { subscription_id: subscription } })
      await completeOutbox(pool, (await pool.query('SELECT id FROM commercial_outbox WHERE dedupe_key=$1', [`${kind}:2`])).rows[0].id)
    }
    expect(await items('notice_failed')).toHaveLength(0)
  })
})
