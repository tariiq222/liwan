import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import { url, client, money, monthly } from './commercial-helpers.js'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { migrate } from '../db.js'
import { createQuoteForCustomer } from '../commercial/quotes.js'
import { acceptQuote } from '../commercial/orders.js'
import { getVendorInvoice } from '../commercial/invoices.js'
import { confirmBankTransfer, bankTransferInstructions } from '../commercial/bank-transfer.js'
import { billingSettings, setBillingSettings } from '../commercial/billing-settings.js'
import { refundEligibility } from '../commercial/settlements.js'
import { refundCreditNote } from '../commercial/settlements.js'
import { routesB } from '../commercial/routes-b.js'

const suite = url ? describe : describe.skip
const AI_LIMITS = { 'ai.messages.monthly': 500, 'ai.tokens.monthly': 2500000, 'ai.assist.monthly': 100, 'ai.tool_calls.per_run': 8, 'ai.output_tokens.per_run': 2000 }
const POLICY_NO_TAX = '6f1c3d8e-0000-4000-8000-000000000002'

/** The one settings row is shared by every test in this file: start each from the release-1 defaults. */
async function resetBillingSettings(pool: Pool) {
  await pool.query("UPDATE billing_settings SET refund_window_days=14,bank_account_name='',bank_account_number='',bank_iban='',bank_instructions_ar='',bank_instructions_en='' WHERE singleton")
}

/** Publishes the release-1 catalog, whose AI limits these plans carry. */
async function publishRelease1(pool: Pool, api: ReturnType<typeof client>, reason: string) {
  const version = `commercial-${randomUUID()}`
  const raw = await readFile(new URL('../../../../deploy/catalog/solutions/platform_v4.json', import.meta.url))
  await pool.query("INSERT INTO catalog_entries(id,version,status,solution,source_sha256) VALUES($1,$2,'published',$3,$4)",
    [randomUUID(), version, JSON.parse(raw.toString()), createHash('sha256').update(raw).digest('hex')])
  const created = await api('POST', '/catalog/releases', { catalog_version: version, reason })
  expect(created.status, JSON.stringify(created.body)).toBe(201)
  return created.body
}

suite('bank transfer (W5)', () => {
  const pool = new Pool({ connectionString: url, max: 6 })
  const api = client(pool)
  const vendor: any = { actor_id: '7', kind: 'vendor', customer_id: null, tenant_id: null, capabilities: ['vendor.subscriptions.manage', 'vendor.pricing.manage', 'vendor.billing.manage'] }
  let plan: any

  beforeAll(async () => {
    await migrate(pool)
    await publishRelease1(pool, api, 'Bank acceptance')
    const draft = await api('POST', '/plans', { name: `Bank ${randomUUID()}`, audience: { kind: 'public' }, term_months: 12, currency: 'SAR',
      prices: [{ cadence: monthly, amount: money(9900) }], platform_limits: AI_LIMITS, included_bundle_revision_ids: [], optional_bundle_revision_ids: [],
      included_extra_branches: 0, extra_branch_prices: [{ cadence: monthly, amount: money(0) }], extra_branches_limit: null,
      included_users: 3, included_storage_mb: 5120, user_prices: [{ cadence: monthly, amount: money(2900) }], storage_prices: [{ cadence: monthly, amount: money(100) }],
      policy_revision_id: POLICY_NO_TAX, trial_days: 0, grace_days: 0, auto_suspend: true, auto_renew_allowed: true })
    expect(draft.status, JSON.stringify(draft.body)).toBe(201)
    const validated = await api('POST', `/plans/${draft.body.id}/validate`, { edit_revision: 1, reason: 'Bank acceptance' })
    expect(validated.status, JSON.stringify(validated.body)).toBe(200)
    plan = (await api('POST', `/plans/${draft.body.id}/publish`, { edit_revision: validated.body.edit_revision, reason: 'Bank acceptance' })).body
  })
  beforeEach(async () => {
    await pool.query('TRUNCATE customers CASCADE')
    await pool.query('TRUNCATE commercial_outbox')
    await resetBillingSettings(pool)
  })
  afterAll(async () => { await pool.end() })

  /** An accepted, unpaid order for one customer with its issued invoice. */
  async function unpaidOrder() {
    const id = randomUUID()
    const tenant = randomUUID()
    await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,'Customer','saas','managed',$2,true)", [tenant, `c-${tenant}`])
    await pool.query('INSERT INTO customers(id,name,tenant_id,admin_name,admin_login) VALUES($1,$2,$3,$4,$5)', [id, 'Bank customer', tenant, 'Manager', 'bank@example.test'])
    const quote = await createQuoteForCustomer(pool, { customer_id: id, request: { kind: 'new', plan_revision_id: plan.id, bundle_revision_ids: [], cadence: monthly,
      requested_extra_branches: 0, requested_users: 3, requested_storage_mb: 5120 } })
    const { order } = await acceptQuote(pool, { quote_id: quote.id, expected_subscription_revision: 0, idempotency_key: randomUUID() }, vendor)
    const invoice = (await pool.query("SELECT * FROM invoices WHERE order_id=$1 AND status='issued'", [order.id])).rows[0]
    return { customer_id: id, order, invoice }
  }
  const transfer = (invoice: any, over: Record<string, unknown> = {}) => ({ reference: `TRF-${randomUUID().slice(0, 8)}`, amount: Number(invoice.total_minor),
    value_date: '2026-11-06', ...over })

  it('records a received transfer and activates through the same path a Moyasar success uses', async () => {
    const { customer_id, order, invoice } = await unpaidOrder()
    const result = await confirmBankTransfer(pool, { invoice_id: invoice.id, operator: 'vendor:7', ...transfer(invoice) } as never)
    expect(result.attempt).toMatchObject({ provider: 'bank_transfer', mode: 'live' })
    const row = (await pool.query('SELECT payment_state, fulfillment_state, paid_attempt_id FROM orders WHERE id=$1', [order.id])).rows[0]
    expect(row.payment_state).toBe('paid')
    expect(row.fulfillment_state).toBe('queued')
    expect(row.paid_attempt_id).toBe(result.attempt.id)
    expect((await pool.query("SELECT status FROM invoices WHERE id=$1", [invoice.id])).rows[0].status).toBe('paid')
    // The activation is the ordinary fulfillment outbox entry, exactly as a confirmed payment enqueues it.
    const outbox = (await pool.query("SELECT kind,payload FROM commercial_outbox WHERE kind='fulfillment.enqueue' AND aggregate_id=$1", [order.id])).rows
    expect(outbox).toHaveLength(1)
    expect(outbox[0].payload).toMatchObject({ order_id: order.id })
    expect((await pool.query("SELECT 1 FROM audit_events WHERE action='payment.bank_transfer_received' AND subject=$1", [order.id])).rowCount).toBe(1)
    void customer_id
  })

  it('is idempotent: the same reference twice pays once and enqueues one activation', async () => {
    const { order, invoice } = await unpaidOrder()
    const body = transfer(invoice)
    const first = await confirmBankTransfer(pool, { invoice_id: invoice.id, operator: 'vendor:7', ...body } as never)
    const second = await confirmBankTransfer(pool, { invoice_id: invoice.id, operator: 'vendor:7', ...body } as never)
    expect(second.replay).toBe(true)
    expect(second.attempt.id).toBe(first.attempt.id)
    expect((await pool.query('SELECT count(*)::int AS n FROM payment_attempts WHERE order_id=$1', [order.id])).rows[0].n).toBe(1)
    expect((await pool.query("SELECT count(*)::int AS n FROM commercial_outbox WHERE kind='fulfillment.enqueue' AND aggregate_id=$1", [order.id])).rows[0].n).toBe(1)
  })

  it('refuses an amount that does not match the invoice, and a wrong amount is never recorded', async () => {
    const { order, invoice } = await unpaidOrder()
    for (const amount of [Number(invoice.total_minor) - 1, Number(invoice.total_minor) + 1, 0]) {
      await expect(confirmBankTransfer(pool, { invoice_id: invoice.id, operator: 'vendor:7', ...transfer(invoice, { amount }) } as never))
        .rejects.toMatchObject({ status: 422, code: 'transfer_amount_mismatch' })
    }
    expect((await pool.query("SELECT payment_state FROM orders WHERE id=$1", [order.id])).rows[0].payment_state).toBe('awaiting_payment')
    expect((await pool.query('SELECT count(*)::int AS n FROM payment_attempts WHERE order_id=$1', [order.id])).rows[0].n).toBe(0)
  })

  it('refuses a second transfer for an order already paid', async () => {
    const { invoice } = await unpaidOrder()
    await confirmBankTransfer(pool, { invoice_id: invoice.id, operator: 'vendor:7', ...transfer(invoice) } as never)
    await expect(confirmBankTransfer(pool, { invoice_id: invoice.id, operator: 'vendor:7', ...transfer(invoice) } as never))
      .rejects.toMatchObject({ status: 409 })
  })

  it('settles reserve, payment and audit in one transaction: a failure after the reserve leaves nothing behind', async () => {
    const { order, invoice } = await unpaidOrder()
    // Fail the settlement itself, after the attempt row was reserved inside the transaction.
    const payments = await import('../commercial/payments.js')
    const spy = vi.spyOn(payments, 'settleAttemptIn').mockRejectedValueOnce(new Error('settlement exploded'))
    try {
      await expect(confirmBankTransfer(pool, { invoice_id: invoice.id, operator: 'vendor:7', ...transfer(invoice) } as never)).rejects.toThrow('settlement exploded')
    } finally { spy.mockRestore() }
    // Nothing was recorded and nothing was paid: the reserve rolled back with the settlement.
    expect((await pool.query('SELECT count(*)::int AS n FROM payment_attempts WHERE order_id=$1', [order.id])).rows[0].n).toBe(0)
    expect((await pool.query('SELECT payment_state FROM orders WHERE id=$1', [order.id])).rows[0].payment_state).toBe('awaiting_payment')
    // And the retry settles it.
    const retry = await confirmBankTransfer(pool, { invoice_id: invoice.id, operator: 'vendor:7', ...transfer(invoice) } as never)
    expect(retry.replay).toBe(false)
    expect((await pool.query('SELECT payment_state FROM orders WHERE id=$1', [order.id])).rows[0].payment_state).toBe('paid')
  })

  it('a reserved attempt that was never applied is settled by the retry, not reported as a replay', async () => {
    const { order, invoice } = await unpaidOrder()
    const body = transfer(invoice)
    // Simulate the crash A3 names: the attempt committed as succeeded but the order was never paid.
    const attemptId = randomUUID()
    await pool.query(`INSERT INTO payment_attempts(id,order_id,invoice_id,provider,mode,provider_ref,amount_minor,currency,exponent,status,value_date)
      VALUES($1,$2,$3,'bank_transfer','live',$4,$5,$6,$7,'succeeded',$8)`,
    [attemptId, order.id, invoice.id, body.reference, Number(invoice.total_minor), invoice.currency, Number(invoice.exponent), body.value_date])
    expect((await pool.query('SELECT payment_state FROM orders WHERE id=$1', [order.id])).rows[0].payment_state).toBe('awaiting_payment')
    const retry = await confirmBankTransfer(pool, { invoice_id: invoice.id, operator: 'vendor:7', ...body } as never)
    expect(retry.replay).toBe(true)
    expect((await pool.query('SELECT payment_state FROM orders WHERE id=$1', [order.id])).rows[0].payment_state).toBe('paid')
    expect((await pool.query("SELECT count(*)::int AS n FROM commercial_outbox WHERE kind='fulfillment.enqueue' AND aggregate_id=$1", [order.id])).rows[0].n).toBe(1)
  })

  it('two operators recording different references at once pay the order exactly once', async () => {
    const { order, invoice } = await unpaidOrder()
    const results = await Promise.allSettled([
      confirmBankTransfer(pool, { invoice_id: invoice.id, operator: 'vendor:7', ...transfer(invoice) } as never),
      confirmBankTransfer(pool, { invoice_id: invoice.id, operator: 'vendor:8', ...transfer(invoice) } as never),
    ])
    const ok = results.filter(r => r.status === 'fulfilled')
    expect(ok).toHaveLength(1)
    const failed = results.find(r => r.status === 'rejected') as PromiseRejectedResult
    expect(failed.reason).toMatchObject({ status: 409 })
    // The loser left no row behind, because its whole transaction rolled back.
    expect((await pool.query("SELECT count(*)::int AS n FROM payment_attempts WHERE order_id=$1 AND provider='bank_transfer'", [order.id])).rows[0].n).toBe(1)
    expect((await pool.query('SELECT payment_state FROM orders WHERE id=$1', [order.id])).rows[0].payment_state).toBe('paid')
    expect((await pool.query("SELECT count(*)::int AS n FROM commercial_outbox WHERE kind='fulfillment.enqueue' AND aggregate_id=$1", [order.id])).rows[0].n).toBe(1)
  })

  it('refuses a value date that is not a real calendar date, and one in the future', async () => {
    const { invoice } = await unpaidOrder()
    for (const value_date of ['2026-13-45', '2026-02-30', '2026-11-6', '2999-01-01']) {
      await expect(confirmBankTransfer(pool, { invoice_id: invoice.id, operator: 'vendor:7', ...transfer(invoice, { value_date }) } as never))
        .rejects.toMatchObject({ status: 422, code: 'invalid_value_date' })
    }
  })

  it('records the transfer\'s own value date as the immutable success time', async () => {
    const { order, invoice } = await unpaidOrder()
    const body = transfer(invoice, { value_date: '2026-11-01' })
    await confirmBankTransfer(pool, { invoice_id: invoice.id, operator: 'vendor:7', ...body } as never)
    const attempt = (await pool.query("SELECT value_date,succeeded_at FROM payment_attempts WHERE order_id=$1 AND provider='bank_transfer'", [order.id])).rows[0]
    expect(attempt.succeeded_at).toBeInstanceOf(Date)
    expect(attempt.succeeded_at.toISOString().slice(0, 10)).toBe('2026-11-01')
  })

  it('needs the billing capability: an operator without it cannot record a transfer', async () => {
    const { invoice } = await unpaidOrder()
    await expect(routesB(pool, { method: 'POST', pathname: `/v1/commercial/invoices/${invoice.id}/bank-transfer`,
      raw: JSON.stringify({ reference: 'TRF-1', amount: Number(invoice.total_minor), value_date: '2026-11-06' }),
      issuer: 'bank-test', actor: 1, capabilities: ['vendor.subscriptions.manage'], stepUpFresh: true }, new URL('http://localhost/v1/commercial')))
      .rejects.toMatchObject({ status: 403 })
  })

  it('shows the customer the vendor-configured bank account while the invoice stays unpaid', async () => {
    await setBillingSettings(pool, { operator: 'vendor:7', reason: 'Release 1 billing settings', bank_account_name: 'شركة المثال', bank_account_number: '1234567890',
      bank_iban: 'SA4420000001234567891234', bank_instructions_ar: 'حوّل المبلغ ثم أرسل الإيصال.', bank_instructions_en: 'Transfer, then send the receipt.' })
    const settings = await billingSettings(pool)
    expect(settings).toMatchObject({ bank_account_name: 'شركة المثال', bank_iban: 'SA4420000001234567891234', refund_window_days: 14 })
    const { invoice } = await unpaidOrder()
    const instructions = await bankTransferInstructions(pool, { invoice_id: invoice.id })
    expect(instructions).toMatchObject({ invoice_id: invoice.id, status: 'issued', amount_minor: Number(invoice.total_minor) })
    expect(instructions.bank).toMatchObject({ account_name: 'شركة المثال', iban: 'SA4420000001234567891234' })
  })

  it('shows only the customer\'s own invoice instructions, never another customer\'s', async () => {
    await setBillingSettings(pool, { operator: 'vendor:7', reason: 'Release 1 billing settings', bank_account_name: 'شركة المثال',
      bank_iban: 'SA4420000001234567891234', bank_instructions_ar: 'حوّل المبلغ.', bank_instructions_en: 'Transfer.' })
    const { customer_id, invoice } = await unpaidOrder()
    const other = randomUUID()
    await expect(bankTransferInstructions(pool, { invoice_id: invoice.id, customer_id: customer_id })).resolves.toMatchObject({ invoice_id: invoice.id })
    await expect(bankTransferInstructions(pool, { invoice_id: invoice.id, customer_id: other })).rejects.toMatchObject({ status: 404 })
  })

  it('offers no transfer instructions until the vendor fills the account in', async () => {
    await setBillingSettings(pool, { operator: 'vendor:7', reason: 'Release 1 billing settings', bank_account_name: '', bank_account_number: '', bank_iban: '', bank_instructions_ar: '', bank_instructions_en: '' })
    const { invoice } = await unpaidOrder()
    await expect(bankTransferInstructions(pool, { invoice_id: invoice.id })).rejects.toMatchObject({ status: 409, code: 'bank_account_unavailable' })
  })
})

suite('the 14-day refund window (W7)', () => {
  const pool = new Pool({ connectionString: url, max: 6 })
  const api = client(pool)
  const vendor: any = { actor_id: '7', kind: 'vendor', customer_id: null, tenant_id: null, capabilities: ['vendor.subscriptions.manage', 'vendor.pricing.manage', 'vendor.billing.manage'] }
  let plan: any
  const actor = { issuer: 'refund-test', actorUid: 7 }

  beforeAll(async () => {
    await migrate(pool)
    await publishRelease1(pool, api, 'Refund acceptance')
    const draft = await api('POST', '/plans', { name: `Refund ${randomUUID()}`, audience: { kind: 'public' }, term_months: 12, currency: 'SAR',
      prices: [{ cadence: monthly, amount: money(9900) }], platform_limits: AI_LIMITS, included_bundle_revision_ids: [], optional_bundle_revision_ids: [],
      included_extra_branches: 0, extra_branch_prices: [{ cadence: monthly, amount: money(0) }], extra_branches_limit: null,
      included_users: 3, included_storage_mb: 5120, user_prices: [{ cadence: monthly, amount: money(2900) }], storage_prices: [{ cadence: monthly, amount: money(100) }],
      policy_revision_id: POLICY_NO_TAX, trial_days: 0, grace_days: 0, auto_suspend: true, auto_renew_allowed: true })
    const validated = await api('POST', `/plans/${draft.body.id}/validate`, { edit_revision: 1, reason: 'Refund acceptance' })
    plan = (await api('POST', `/plans/${draft.body.id}/publish`, { edit_revision: validated.body.edit_revision, reason: 'Refund acceptance' })).body
  })
  beforeEach(async () => {
    await pool.query('TRUNCATE customers CASCADE')
    await resetBillingSettings(pool)
  })
  afterAll(async () => { await pool.end() })

  /** A paid order, its paid invoice and the pending credit note the refund would close, at a chosen payment time. */
  async function paidWithCreditNote(paidAt: string, origin: 'vendor' | 'system' = 'vendor') {
    const id = randomUUID()
    const tenant = randomUUID()
    await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,'Customer','saas','managed',$2,true)", [tenant, `c-${tenant}`])
    await pool.query('INSERT INTO customers(id,name,tenant_id,admin_name,admin_login) VALUES($1,$2,$3,$4,$5)', [id, 'Refund customer', tenant, 'Manager', 'refund@example.test'])
    const quote = await createQuoteForCustomer(pool, { customer_id: id, request: { kind: 'new', plan_revision_id: plan.id, bundle_revision_ids: [], cadence: monthly,
      requested_extra_branches: 0, requested_users: 3, requested_storage_mb: 5120 } })
    const { order } = await acceptQuote(pool, { quote_id: quote.id, expected_subscription_revision: 0, idempotency_key: randomUUID() }, vendor)
    const invoice = (await pool.query("SELECT * FROM invoices WHERE order_id=$1 AND status='issued'", [order.id])).rows[0]
    const attemptId = randomUUID()
    await pool.query(`INSERT INTO payment_attempts(id,order_id,invoice_id,provider,mode,provider_ref,amount_minor,currency,exponent,status,updated_at,succeeded_at)
      VALUES($1,$2,$3,'moyasar','live',$4,$5,$6,$7,'succeeded',$8,$8)`, [attemptId, order.id, invoice.id, `moy-${attemptId}`, invoice.total_minor, invoice.currency, invoice.exponent, paidAt])
    await pool.query("UPDATE orders SET payment_state='paid',paid_attempt_id=$2 WHERE id=$1", [order.id, attemptId])
    await pool.query("UPDATE invoices SET status='paid',paid_at=$2 WHERE id=$1", [invoice.id, paidAt])
    const noteId = randomUUID()
    await pool.query(`INSERT INTO invoice_adjustments(id,invoice_id,customer_id,kind,reason,amount_minor,currency,exponent,status,created_by,origin)
      VALUES($1,$2,$3,'credit_note','Refund request',$4,$5,$6,'pending','vendor:7',$7)`, [noteId, invoice.id, id, invoice.total_minor, invoice.currency, invoice.exponent, origin])
    return { customer_id: id, order, invoice, noteId }
  }
  const ask = (noteId: string) => refundCreditNote(pool, { adjustment_id: noteId, actor, request: { external_reference: `MOY-${randomUUID().slice(0, 8)}`, reason: 'Customer asked within the window' } })

  it('accepts a refund on day 14 and refuses it on day 15', async () => {
    const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()
    const day14 = await paidWithCreditNote(daysAgo(14))
    await expect(ask(day14.noteId)).resolves.toMatchObject({ status: 'refunded' })
    const day15 = await paidWithCreditNote(daysAgo(15))
    await expect(ask(day15.noteId)).rejects.toMatchObject({ status: 409, code: 'refund_window_closed' })
    expect((await pool.query('SELECT status FROM invoice_adjustments WHERE id=$1', [day15.noteId])).rows[0].status).toBe('pending')
  })

  it('refuses a renewal: only the customer\'s first payment is refundable', async () => {
    const { customer_id, invoice } = await paidWithCreditNote(new Date().toISOString())
    // A renewal: a later, successful payment for the same customer, so refunding it is not the customer's first.
    const laterOrder = randomUUID()
    await pool.query(`INSERT INTO orders(id,customer_id,subscription_id,kind,quote_id,target_revision_id,payment_state,fulfillment_state,effective_at,idempotency_key,request_digest,due_now_minor,currency,exponent)
      SELECT $1,customer_id,subscription_id,'renewal',gen_random_uuid(),target_revision_id,'paid','applied',now()+interval '30 days',$2,'d',$3,currency,exponent FROM orders WHERE id=(SELECT order_id FROM invoices WHERE id=$4)`,
      [laterOrder, `k-${laterOrder}`, invoice.total_minor, invoice.id])
    const laterInvoice = randomUUID()
    await pool.query(`INSERT INTO invoices(id,number,customer_id,subscription_id,order_id,kind,status,currency,exponent,subtotal_minor,tax_minor,total_minor,period_start,period_end,paid_at,issued_at)
      SELECT $1,'INV-L',customer_id,subscription_id,$2,'renewal','paid',currency,exponent,subtotal_minor,0,total_minor,current_date,current_date+30,now(),now() FROM invoices WHERE id=$3`,
      [laterInvoice, laterOrder, invoice.id])
    await pool.query(`INSERT INTO payment_attempts(id,order_id,invoice_id,provider,mode,provider_ref,amount_minor,currency,exponent,status,updated_at)
      SELECT $1,$2,$3,'moyasar','live',$4,total_minor,currency,exponent,'succeeded',now()+interval '30 days' FROM invoices WHERE id=$3`,
      [randomUUID(), laterOrder, laterInvoice, `moy-${laterOrder.slice(0, 8)}`])
    const noteId = randomUUID()
    await pool.query(`INSERT INTO invoice_adjustments(id,invoice_id,customer_id,kind,reason,amount_minor,currency,exponent,status,created_by)
      VALUES($1,$2,$3,'credit_note','Renewal refund',$4,'SAR',2,'pending','vendor:7')`, [noteId, laterInvoice, customer_id, invoice.total_minor])
    await expect(ask(noteId)).rejects.toMatchObject({ status: 409, code: 'refund_not_first_payment' })
  })

  it('never refunds a refund already made, and keeps the window length a vendor-editable value', async () => {
    const paid = await paidWithCreditNote(new Date().toISOString())
    await ask(paid.noteId)
    const settings = await billingSettings(pool)
    expect(settings.refund_window_days).toBe(14)
    await setBillingSettings(pool, { operator: 'vendor:7', reason: 'Release 1 billing settings', refund_window_days: 0 })
    const closed = await paidWithCreditNote(new Date().toISOString())
    await expect(ask(closed.noteId)).rejects.toMatchObject({ code: 'refund_window_closed' })
  })

  it('refuses a partial credit note: only a full refund of the invoice is recorded', async () => {
    const { noteId, invoice } = await paidWithCreditNote(new Date().toISOString())
    await pool.query('UPDATE invoice_adjustments SET amount_minor=$2 WHERE id=$1', [noteId, Number(invoice.total_minor) - 1])
    await expect(ask(noteId)).rejects.toMatchObject({ status: 409, code: 'refund_not_full' })
    expect((await pool.query('SELECT status FROM invoice_adjustments WHERE id=$1', [noteId])).rows[0].status).toBe('pending')
  })

  it('refuses a second refunded note on one invoice', async () => {
    const { invoice, customer_id } = await paidWithCreditNote(new Date().toISOString())
    const first = (await pool.query('SELECT id FROM invoice_adjustments WHERE invoice_id=$1', [invoice.id])).rows[0]
    await ask(first.id)
    // A second note covering the same invoice (a duplicate charge, say) can never be refunded twice.
    const second = randomUUID()
    await pool.query(`INSERT INTO invoice_adjustments(id,invoice_id,customer_id,kind,reason,amount_minor,currency,exponent,status,created_by,origin)
      VALUES($1,$2,$3,'credit_note','Second note',$4,'SAR',2,'pending','system','system')`, [second, invoice.id, customer_id, invoice.total_minor])
    await expect(ask(second)).rejects.toMatchObject({ status: 409, code: 'invoice_already_refunded' })
  })

  it('lets a system-created credit note be refunded outside the window', async () => {
    // A5: a duplicate charge on day 20 is money the customer never planned to spend; the window must not strand it.
    const old = await paidWithCreditNote(new Date(Date.now() - 20 * 86_400_000).toISOString(), 'system')
    await expect(ask(old.noteId)).resolves.toMatchObject({ status: 'refunded' })
    // The same age as a customer-requested note is still refused: that is the owner's rule.
    const requested = await paidWithCreditNote(new Date(Date.now() - 20 * 86_400_000).toISOString(), 'vendor')
    await expect(ask(requested.noteId)).rejects.toMatchObject({ code: 'refund_window_closed' })
  })

  it('measures the window from the immutable success time, not from a later touch', async () => {
    const paid = await paidWithCreditNote(new Date(Date.now() - 3 * 86_400_000).toISOString())
    // Reconciliation and sibling cancellation rewrite updated_at; succeeded_at must not move with it.
    await pool.query("UPDATE payment_attempts SET updated_at=now() + interval '30 days' WHERE order_id=$1", [paid.order.id])
    const eligibility = await refundEligibility(pool, paid.customer_id, paid.invoice.id)
    expect(eligibility).toMatchObject({ refundable: true, first_payment: true })
  })

  it('tells the vendor whether a payment is still refundable and until when', async () => {
    const paid = await paidWithCreditNote(new Date(Date.now() - 3 * 86_400_000).toISOString())
    const view = await getVendorInvoice(pool, paid.invoice.id)
    expect(view).toBeTruthy()
    expect(view!.refund).toMatchObject({ refundable: true, first_payment: true })
    expect(view!.refund.until).toBeTruthy()
    const old = await paidWithCreditNote(new Date(Date.now() - 30 * 86_400_000).toISOString())
    const closed = await getVendorInvoice(pool, old.invoice.id)
    expect(closed!.refund).toMatchObject({ refundable: false, first_payment: true })
  })
})
