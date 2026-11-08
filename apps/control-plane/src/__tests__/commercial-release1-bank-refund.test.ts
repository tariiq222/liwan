import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import { url, client, money, monthly } from './commercial-helpers.js'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { migrate } from '../db.js'
import { createQuoteForCustomer } from '../commercial/quotes.js'
import { riyadhDate } from '@liwan/commercial-contracts'
import { acceptQuote } from '../commercial/orders.js'
import { getVendorInvoice } from '../commercial/invoices.js'
import { confirmBankTransfer, bankTransferInstructions } from '../commercial/bank-transfer.js'
import { billingSettings, setBillingSettings } from '../commercial/billing-settings.js'
import { refundEligibility } from '../commercial/settlements.js'
import { processRefundOutbox, refundCreditNote } from '../commercial/settlements.js'
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
      included_users: 3, included_storage_mb: 20480, storage_step_mb: 10240, storage_step_threshold_mb: 102400, storage_large_step_mb: 102400, user_prices: [{ cadence: monthly, amount: money(2900) }], storage_prices: [{ cadence: monthly, amount: money(100) }],
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
    await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,'Customer','saas','dedicated_managed',$2,true)", [tenant, `c-${tenant}`])
    await pool.query('INSERT INTO customers(id,name,tenant_id,admin_name,admin_login) VALUES($1,$2,$3,$4,$5)', [id, 'Bank customer', tenant, 'Manager', 'bank@example.test'])
    const quote = await createQuoteForCustomer(pool, { customer_id: id, request: { kind: 'new', plan_revision_id: plan.id, bundle_revision_ids: [], cadence: monthly,
      requested_extra_branches: 0, requested_users: 3, requested_storage_mb: 20480 } })
    const { order } = await acceptQuote(pool, { quote_id: quote.id, expected_subscription_revision: 0, idempotency_key: randomUUID() }, vendor)
    const invoice = (await pool.query("SELECT * FROM invoices WHERE order_id=$1 AND status='issued'", [order.id])).rows[0]
    return { customer_id: id, order, invoice }
  }
  // Today in Riyadh: an invoice raised by the fixture is issued today, and a value date before that is now refused.
  const today = riyadhDate(new Date())
  const transfer = (invoice: any, over: Record<string, unknown> = {}) => ({ reference: `TRF-${randomUUID().slice(0, 8)}`, amount: Number(invoice.total_minor),
    value_date: today, ...over })

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

  it('records a second transfer for an order already paid as a duplicate instead of losing the money', async () => {
    // The money is real even when the order is paid: it is written down and queued for a credit note, so the customer's
    // second transfer is never lost. Only the first one pays the order.
    const { order, invoice } = await unpaidOrder()
    await confirmBankTransfer(pool, { invoice_id: invoice.id, operator: 'vendor:7', ...transfer(invoice) } as never)
    const second = await confirmBankTransfer(pool, { invoice_id: invoice.id, operator: 'vendor:7', ...transfer(invoice) } as never)
    expect(second.attempt).toMatchObject({ provider: 'bank_transfer', status: 'succeeded' })
    expect(second.replay).toBe(false)
    const rows = (await pool.query("SELECT count(*)::int AS n FROM payment_attempts WHERE order_id=$1 AND provider='bank_transfer'", [order.id])).rows[0]
    expect(rows.n).toBe(2)
    // And the order is still paid once.
    expect((await pool.query('SELECT payment_state FROM orders WHERE id=$1', [order.id])).rows[0].payment_state).toBe('paid')
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
    // Simulate the crash A3 names: the attempt row committed as `pending` (reserved) and the settlement never ran, so
    // the order is still awaiting payment. A `succeeded` row here would mean the settlement DID run.
    const attemptId = randomUUID()
    await pool.query(`INSERT INTO payment_attempts(id,order_id,invoice_id,provider,mode,provider_ref,amount_minor,currency,exponent,status,value_date)
      VALUES($1,$2,$3,'bank_transfer','live',$4,$5,$6,$7,'pending',$8)`,
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
    // Both are fulfilled: the winner pays the order, and the loser is recorded as a duplicate transfer (its money is
    // real, so it becomes a credit note rather than an error). What must never happen is paying the order twice.
    const ok = results.filter(r => r.status === 'fulfilled').map(r => (r as PromiseFulfilledResult<any>).value)
    expect(ok).toHaveLength(2)
    expect(ok.filter(r => r.replay === false && r.attempt.status === 'succeeded')).toHaveLength(2)
    // Two rows, one paid order: the second is the duplicate, not a second settlement.
    expect((await pool.query("SELECT count(*)::int AS n FROM payment_attempts WHERE order_id=$1 AND provider='bank_transfer'", [order.id])).rows[0].n).toBe(2)
    expect((await pool.query('SELECT payment_state FROM orders WHERE id=$1', [order.id])).rows[0].payment_state).toBe('paid')
    expect((await pool.query("SELECT count(*)::int AS n FROM commercial_outbox WHERE kind='fulfillment.enqueue' AND aggregate_id=$1", [order.id])).rows[0].n).toBe(1)
  })

  it('refuses a value date that is not a real calendar date, and one in the future', async () => {
    const { invoice } = await unpaidOrder()
    for (const value_date of ['2026-13-45', '2026-02-30', '2026-11-6']) {
      await expect(confirmBankTransfer(pool, { invoice_id: invoice.id, operator: 'vendor:7', ...transfer(invoice, { value_date }) } as never))
        .rejects.toMatchObject({ status: 422, code: 'invalid_value_date' })
    }
    // A5: the future is its own code, so the operator is told the date is early rather than that it is malformed.
    await expect(confirmBankTransfer(pool, { invoice_id: invoice.id, operator: 'vendor:7', ...transfer(invoice, { value_date: '2999-01-01' }) } as never))
      .rejects.toMatchObject({ status: 422, code: 'value_date_in_future' })
  })

  it('refuses a value date before the invoice was issued, and accepts the issue date itself', async () => {
    const { invoice } = await unpaidOrder()
    // The invoice was issued today (Riyadh); yesterday closes the refund window on money that was in fact received today.
    // Every date here is a Riyadh calendar day, as in the production code, so the test does not flake between 00:00 and 03:00 Riyadh.
    const yesterday = riyadhDate(new Date(Date.now() - 86_400_000))
    await expect(confirmBankTransfer(pool, { invoice_id: invoice.id, operator: 'vendor:7', ...transfer(invoice, { value_date: yesterday }) } as never))
      .rejects.toMatchObject({ status: 422, code: 'value_date_before_invoice' })
    const issued = riyadhDate(new Date(invoice.issued_at))
    await expect(confirmBankTransfer(pool, { invoice_id: invoice.id, operator: 'vendor:7', ...transfer(invoice, { value_date: issued }) } as never))
      .resolves.toMatchObject({ replay: false })
  })

  it('gives every invalid field its own code instead of blaming the date', async () => {
    const { invoice } = await unpaidOrder()
    const base = transfer(invoice)
    await expect(confirmBankTransfer(pool, { invoice_id: invoice.id, operator: 'vendor:7', ...base, reference: 'ab' } as never))
      .rejects.toMatchObject({ status: 422, code: 'invalid_transfer_reference', field: 'reference' })
    await expect(confirmBankTransfer(pool, { invoice_id: invoice.id, operator: 'vendor:7', ...base, amount: -1 } as never))
      .rejects.toMatchObject({ status: 422, code: 'invalid_transfer_amount', field: 'amount' })
    await expect(confirmBankTransfer(pool, { invoice_id: invoice.id, operator: 'vendor:7', ...base, reason: 'x' } as never))
      .rejects.toMatchObject({ status: 422, code: 'invalid_transfer_reason', field: 'reason' })
  })

  it('returns each refused transfer field with its own code through the route', async () => {
    // The route parses the body before confirmBankTransfer runs: a code the inner function maps must not be flattened to
    // `invalid` on the way in. This goes through the route handler the proxy calls, never the inner function.
    const { invoice } = await unpaidOrder()
    const base = transfer(invoice)
    const post = (body: unknown, raw?: string) => routesB(pool, { method: 'POST', pathname: `/v1/commercial/invoices/${invoice.id}/bank-transfer`,
      raw: raw ?? JSON.stringify(body), issuer: 'bank-test', actor: 7, capabilities: ['vendor.billing.manage'], stepUpFresh: true }, new URL('http://localhost/v1/commercial'))
    const yesterday = riyadhDate(new Date(Date.now() - 86_400_000))
    const cases: Array<[string, Record<string, unknown>, string, string]> = [
      ['a future date', { value_date: '2999-01-01' }, 'value_date_in_future', 'value_date'],
      ['a date before the invoice', { value_date: yesterday }, 'value_date_before_invoice', 'value_date'],
      ['a date that is not on the calendar', { value_date: '2026-02-30' }, 'invalid_value_date', 'value_date'],
      ['a malformed date', { value_date: '2026-11-6' }, 'invalid_value_date', 'value_date'],
      ['a 2-character reference', { reference: 'ab' }, 'invalid_transfer_reference', 'reference'],
      ['a negative amount', { amount: -1 }, 'invalid_transfer_amount', 'amount'],
      ['an amount that is not a number', { amount: '115.00' }, 'invalid_transfer_amount', 'amount'],
      ['a reason that is too short', { reason: 'x' }, 'invalid_transfer_reason', 'reason'],
      ['an amount that is not the invoice total', { amount: Number(invoice.total_minor) - 1 }, 'transfer_amount_mismatch', ''],
    ]
    for (const [label, over, code, field] of cases)
      await expect(post({ ...base, ...over }), label).rejects.toMatchObject({ status: 422, code, ...(field ? { field } : {}) })
    // What belongs to no single field stays generic.
    await expect(post({ ...base, surprise: true })).rejects.toMatchObject({ status: 422, code: 'invalid' })
    await expect(post(null, 'not json')).rejects.toMatchObject({ status: 422, code: 'invalid', field: 'body' })
    // And none of the refusals recorded anything.
    expect((await pool.query('SELECT count(*)::int AS n FROM payment_attempts WHERE invoice_id=$1', [invoice.id])).rows[0].n).toBe(0)
    await expect(post(base)).resolves.toMatchObject({ status: 201 })
  })

  it('builds succeeded_at in Riyadh time even when the session timezone is not', async () => {
    // A5: a bare date::timestamp depends on the session TimeZone, so the same value date would land on a different
    // refund-window day depending on the client. The statement names Asia/Riyadh, so the instant does not move.
    const { invoice } = await unpaidOrder()
    const body = transfer(invoice, { value_date: riyadhDate(new Date()) })
    await pool.query("SET TIME ZONE 'America/Los_Angeles'")
    try {
      await confirmBankTransfer(pool, { invoice_id: invoice.id, operator: 'vendor:7', ...body } as never)
    } finally { await pool.query("SET TIME ZONE 'UTC'") }
    const row = (await pool.query("SELECT succeeded_at FROM payment_attempts WHERE provider_ref=$1", [body.reference])).rows[0]
    // Noon Riyadh on the value date is 09:00Z; whatever the session, the Riyadh calendar day does not move.
    const day = riyadhDate(new Date())
    expect(row.succeeded_at.toISOString()).toBe(`${day}T09:00:00.000Z`)
    expect(riyadhDate(new Date(row.succeeded_at))).toBe(day)
  })

  it('records a second transfer on a paid invoice as a duplicate and queues one credit note', async () => {
    // A3: the money really arrived. Refusing it silently lost it; it is now stored with its own reference, audited, and
    // handed to the existing duplicate-charge path, which writes a system credit note for the operator to refund.
    const { customer_id, order, invoice } = await unpaidOrder()
    const first = await confirmBankTransfer(pool, { invoice_id: invoice.id, operator: 'vendor:7', ...transfer(invoice) } as never)
    const second = await confirmBankTransfer(pool, { invoice_id: invoice.id, operator: 'vendor:7', ...transfer(invoice) } as never)
    expect(second.replay).toBe(false)
    expect(second.attempt.id).not.toBe(first.attempt.id)
    // Its own reference, its own succeeded attempt.
    const attempt = (await pool.query('SELECT * FROM payment_attempts WHERE id=$1', [second.attempt.id])).rows[0]
    expect(attempt).toMatchObject({ provider: 'bank_transfer', status: 'succeeded' })
    expect(attempt.provider_ref).not.toBe(first.attempt.provider_ref)
    expect(attempt.succeeded_at).toBeInstanceOf(Date)
    // The order and the first payment do not move.
    const row = (await pool.query('SELECT payment_state, fulfillment_state, paid_attempt_id FROM orders WHERE id=$1', [order.id])).rows[0]
    expect(row).toMatchObject({ payment_state: 'paid', paid_attempt_id: first.attempt.id })
    expect((await pool.query("SELECT count(*)::int AS n FROM commercial_outbox WHERE kind='fulfillment.enqueue' AND aggregate_id=$1", [order.id])).rows[0].n).toBe(1)
    expect((await pool.query('SELECT status FROM invoices WHERE id=$1', [invoice.id])).rows[0].status).toBe('paid')
    // One audit entry and one queued note for the duplicate, nothing for the first beyond its own entry.
    expect((await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action='payment.bank_transfer_duplicate' AND subject=$1 AND metadata->>'attempt_id'=$2", [order.id, second.attempt.id])).rows[0].n).toBe(1)
    expect((await pool.query("SELECT payload FROM commercial_outbox WHERE kind='reconcile.refund' AND aggregate_id=$1", [order.id])).rows[0].payload)
      .toMatchObject({ duplicate: true, attempt_id: second.attempt.id })
    // The consumer writes the note; it is a system note, keyed by that attempt.
    expect(await processRefundOutbox(pool)).toBe(1)
    const notes = (await pool.query('SELECT * FROM invoice_adjustments WHERE invoice_id=$1', [invoice.id])).rows
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({ kind: 'credit_note', status: 'pending', origin: 'system' })
    expect(Number(notes[0].amount_minor)).toBe(Number(invoice.total_minor))
    // The first payment is still the customer's first: the duplicate is a second succeeded attempt, later in time.
    const eligibility = await refundEligibility(pool, customer_id, invoice.id)
    expect(eligibility).toMatchObject({ refundable: true, first_payment: true })
  })

  it('the paying transfer stays the customer\'s first payment even when a duplicate carries an earlier value date', async () => {
    // The dangerous case: a duplicate transfer whose value date is EARLIER than the payment that bought the order. Read
    // by value date alone it would become "the first payment" and the real one would stop being refundable.
    const { customer_id, order, invoice } = await unpaidOrder()
    const day = (ago: number) => riyadhDate(new Date(Date.now() - ago * 86_400_000))
    const paying = await confirmBankTransfer(pool, { invoice_id: invoice.id, operator: 'vendor:7', ...transfer(invoice, { value_date: day(0) }) } as never)
    // A paid invoice is immutable, so the route cannot record a value date before the invoice was issued; the earlier
    // duplicate is written the way a second money-in with its own earlier success time is stored.
    const duplicateId = randomUUID()
    await pool.query(`INSERT INTO payment_attempts(id,order_id,invoice_id,provider,mode,provider_ref,amount_minor,currency,exponent,status,value_date,succeeded_at)
      VALUES($1,$2,$3,'bank_transfer','live',$4,$5,$6,$7,'succeeded',$8::date,($8::timestamp + time '12:00') AT TIME ZONE 'Asia/Riyadh')`,
    [duplicateId, order.id, invoice.id, `TRF-dup-${duplicateId.slice(0, 8)}`, Number(invoice.total_minor), invoice.currency, Number(invoice.exponent), day(3)])
    // By time the duplicate really is the earlier success...
    const byTime = (await pool.query("SELECT id FROM payment_attempts WHERE order_id=$1 AND status='succeeded' ORDER BY succeeded_at,id", [order.id])).rows.map(r => r.id)
    expect(byTime).toEqual([duplicateId, paying.attempt.id])
    // ...yet the order was paid by the other one, and that one is what the rule treats as the first payment.
    expect((await pool.query('SELECT paid_attempt_id FROM orders WHERE id=$1', [order.id])).rows[0].paid_attempt_id).toBe(paying.attempt.id)
    const eligibility = await refundEligibility(pool, customer_id, invoice.id)
    expect(eligibility).toMatchObject({ refundable: true, first_payment: true })
    // The window runs from the paying transfer (today), not from the earlier duplicate (3 days ago).
    const expectedUntil = new Date(Date.parse(`${day(0)}T12:00:00+03:00`) + 14 * 86_400_000).toISOString().slice(0, 10)
    expect(eligibility.until).toBe(`${expectedUntil}T23:59:59+03:00`)
  })

  it('two concurrent transfers on a paid invoice record one payment and one duplicate', async () => {
    const { order, invoice } = await unpaidOrder()
    // Pay it first, so both of these are duplicates.
    const first = await confirmBankTransfer(pool, { invoice_id: invoice.id, operator: 'vendor:7', ...transfer(invoice) } as never)
    const results = await Promise.allSettled([
      confirmBankTransfer(pool, { invoice_id: invoice.id, operator: 'vendor:7', ...transfer(invoice) } as never),
      confirmBankTransfer(pool, { invoice_id: invoice.id, operator: 'vendor:8', ...transfer(invoice) } as never),
    ])
    expect(results.every(r => r.status === 'fulfilled')).toBe(true)
    const ids = results.map(r => (r as PromiseFulfilledResult<{ attempt: Record<string, unknown> }>).value.attempt.id as string)
    expect(new Set(ids).size).toBe(2)
    expect((await pool.query('SELECT paid_attempt_id FROM orders WHERE id=$1', [order.id])).rows[0].paid_attempt_id).toBe(first.attempt.id)
    expect((await pool.query("SELECT count(*)::int AS n FROM commercial_outbox WHERE kind='reconcile.refund' AND aggregate_id=$1", [order.id])).rows[0].n).toBe(2)
    expect((await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action='payment.bank_transfer_duplicate' AND subject=$1", [order.id])).rows[0].n).toBe(2)
    await processRefundOutbox(pool)
    expect((await pool.query("SELECT count(*)::int AS n FROM invoice_adjustments WHERE invoice_id=$1 AND origin='system'", [invoice.id])).rows[0].n).toBe(2)
  })

  it('a concurrent pair of transfers on an unpaid invoice produces one payment and one duplicate', async () => {
    // The order lock decides who pays; the loser is not an error, it is the second transfer of the same money-in.
    const { order, invoice } = await unpaidOrder()
    const results = await Promise.allSettled([
      confirmBankTransfer(pool, { invoice_id: invoice.id, operator: 'vendor:7', ...transfer(invoice) } as never),
      confirmBankTransfer(pool, { invoice_id: invoice.id, operator: 'vendor:8', ...transfer(invoice) } as never),
    ])
    expect(results.every(r => r.status === 'fulfilled')).toBe(true)
    const rows = (await pool.query("SELECT status,id FROM payment_attempts WHERE order_id=$1 AND provider='bank_transfer' ORDER BY created_at", [order.id])).rows
    expect(rows).toHaveLength(2)
    expect(rows.every(r => r.status === 'succeeded')).toBe(true)
    expect((await pool.query('SELECT payment_state FROM orders WHERE id=$1', [order.id])).rows[0].payment_state).toBe('paid')
    expect((await pool.query("SELECT count(*)::int AS n FROM commercial_outbox WHERE kind='fulfillment.enqueue' AND aggregate_id=$1", [order.id])).rows[0].n).toBe(1)
    expect((await pool.query("SELECT count(*)::int AS n FROM commercial_outbox WHERE kind='reconcile.refund' AND aggregate_id=$1", [order.id])).rows[0].n).toBe(1)
  })

  it('still refuses a wrongly-amounted transfer on a paid invoice, a void invoice, and a reused reference', async () => {
    const { order, invoice } = await unpaidOrder()
    await confirmBankTransfer(pool, { invoice_id: invoice.id, operator: 'vendor:7', ...transfer(invoice) } as never)
    // A wrong amount is not a duplicate of this invoice's total: still a real mistake.
    await expect(confirmBankTransfer(pool, { invoice_id: invoice.id, operator: 'vendor:7', ...transfer(invoice, { amount: Number(invoice.total_minor) - 1 }) } as never))
      .rejects.toMatchObject({ status: 422, code: 'transfer_amount_mismatch' })
    // A second invoice whose order was cancelled is not a duplicate either.
    const voided = await unpaidOrder()
    await pool.query("UPDATE invoices SET status='void' WHERE id=$1", [voided.invoice.id])
    await pool.query("UPDATE orders SET cancelled=true WHERE id=$1", [voided.order.id])
    await expect(confirmBankTransfer(pool, { invoice_id: voided.invoice.id, operator: 'vendor:7', ...transfer(voided.invoice) } as never))
      .rejects.toMatchObject({ status: 409, code: 'order_not_payable' })
    // A reference already recorded on ANOTHER invoice is a recorded mistake.
    const other = await unpaidOrder()
    const used = transfer(other.invoice)
    await confirmBankTransfer(pool, { invoice_id: other.invoice.id, operator: 'vendor:7', ...used } as never)
    await expect(confirmBankTransfer(pool, { invoice_id: invoice.id, operator: 'vendor:7', ...used } as never))
      .rejects.toMatchObject({ status: 409, code: 'transfer_reference_in_use' })
  })

  it('never moves succeeded_at once the payment succeeded', async () => {
    // A3/A5: `updated_at` is touched by reconciliation and sibling cancellation; `succeeded_at` is written once.
    const { invoice } = await unpaidOrder()
    const body = transfer(invoice, { value_date: riyadhDate(new Date()) })
    await confirmBankTransfer(pool, { invoice_id: invoice.id, operator: 'vendor:7', ...body } as never)
    const before = (await pool.query("SELECT succeeded_at FROM payment_attempts WHERE provider_ref=$1", [body.reference])).rows[0].succeeded_at
    // A second settlement attempt (the replay path) must leave it alone.
    await confirmBankTransfer(pool, { invoice_id: invoice.id, operator: 'vendor:7', ...body } as never)
    const after = (await pool.query("SELECT succeeded_at,updated_at FROM payment_attempts WHERE provider_ref=$1", [body.reference])).rows[0]
    expect(after.succeeded_at).toEqual(before)
    expect(after.succeeded_at.toISOString().slice(0, 10)).toBe(riyadhDate(new Date()))
  })

  it('records the transfer\'s own value date as the immutable success time', async () => {
    const { order, invoice } = await unpaidOrder()
    const body = transfer(invoice, { value_date: riyadhDate(new Date()) })
    await confirmBankTransfer(pool, { invoice_id: invoice.id, operator: 'vendor:7', ...body } as never)
    const attempt = (await pool.query("SELECT value_date,succeeded_at FROM payment_attempts WHERE order_id=$1 AND provider='bank_transfer'", [order.id])).rows[0]
    expect(attempt.succeeded_at).toBeInstanceOf(Date)
    expect(attempt.succeeded_at.toISOString().slice(0, 10)).toBe(riyadhDate(new Date()))
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
      included_users: 3, included_storage_mb: 20480, storage_step_mb: 10240, storage_step_threshold_mb: 102400, storage_large_step_mb: 102400, user_prices: [{ cadence: monthly, amount: money(2900) }], storage_prices: [{ cadence: monthly, amount: money(100) }],
      policy_revision_id: POLICY_NO_TAX, trial_days: 0, grace_days: 0, auto_suspend: true, auto_renew_allowed: true })
    const validated = await api('POST', `/plans/${draft.body.id}/validate`, { edit_revision: 1, reason: 'Refund acceptance' })
    plan = (await api('POST', `/plans/${draft.body.id}/publish`, { edit_revision: validated.body.edit_revision, reason: 'Refund acceptance' })).body
  })
  beforeEach(async () => {
    await pool.query('TRUNCATE customers CASCADE')
    await resetBillingSettings(pool)
  })
  afterAll(async () => { await pool.end() })

  /** A paid order and its paid invoice at a chosen payment time; `withNote` also plants the pending note the old flow
   * closed, which the A2 route tests must NOT do (the route is what creates the note). */
  async function paidWithCreditNote(paidAt: string, origin: 'vendor' | 'system' = 'vendor', withNote = true) {
    const id = randomUUID()
    const tenant = randomUUID()
    await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,'Customer','saas','dedicated_managed',$2,true)", [tenant, `c-${tenant}`])
    await pool.query('INSERT INTO customers(id,name,tenant_id,admin_name,admin_login) VALUES($1,$2,$3,$4,$5)', [id, 'Refund customer', tenant, 'Manager', 'refund@example.test'])
    const quote = await createQuoteForCustomer(pool, { customer_id: id, request: { kind: 'new', plan_revision_id: plan.id, bundle_revision_ids: [], cadence: monthly,
      requested_extra_branches: 0, requested_users: 3, requested_storage_mb: 20480 } })
    const { order } = await acceptQuote(pool, { quote_id: quote.id, expected_subscription_revision: 0, idempotency_key: randomUUID() }, vendor)
    const invoice = (await pool.query("SELECT * FROM invoices WHERE order_id=$1 AND status='issued'", [order.id])).rows[0]
    const attemptId = randomUUID()
    await pool.query(`INSERT INTO payment_attempts(id,order_id,invoice_id,provider,mode,provider_ref,amount_minor,currency,exponent,status,updated_at,succeeded_at)
      VALUES($1,$2,$3,'moyasar','live',$4,$5,$6,$7,'succeeded',$8,$8)`, [attemptId, order.id, invoice.id, `moy-${attemptId}`, invoice.total_minor, invoice.currency, invoice.exponent, paidAt])
    await pool.query("UPDATE orders SET payment_state='paid',paid_attempt_id=$2 WHERE id=$1", [order.id, attemptId])
    await pool.query("UPDATE invoices SET status='paid',paid_at=$2 WHERE id=$1", [invoice.id, paidAt])
    if (!withNote) return { customer_id: id, order, invoice, noteId: null as string | null }
    const noteId = randomUUID()
    await pool.query(`INSERT INTO invoice_adjustments(id,invoice_id,customer_id,kind,reason,amount_minor,currency,exponent,status,created_by,origin)
      VALUES($1,$2,$3,'credit_note','Refund request',$4,$5,$6,'pending','vendor:7',$7)`, [noteId, invoice.id, id, invoice.total_minor, invoice.currency, invoice.exponent, origin])
    return { customer_id: id, order, invoice, noteId }
  }
  const ask = (noteId: string) => refundCreditNote(pool, { adjustment_id: noteId, actor, request: { external_reference: `MOY-${randomUUID().slice(0, 8)}`, reason: 'Customer asked within the window' } })

  it('accepts a refund request on day 14 and refuses it on day 15', async () => {
    const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()
    const day14 = await paidWithCreditNote(daysAgo(14), 'vendor', false)
    await expect(requestRefund(day14.invoice.id)).resolves.toMatchObject({ status: 201 })
    const day15 = await paidWithCreditNote(daysAgo(15), 'vendor', false)
    await expect(requestRefund(day15.invoice.id)).rejects.toMatchObject({ status: 409, code: 'refund_window_closed' })
    expect((await pool.query('SELECT count(*)::int AS n FROM invoice_adjustments WHERE invoice_id=$1', [day15.invoice.id])).rows[0].n).toBe(0)
  })

  it('records a vendor refund after the window closed, because the window was judged when the note was requested', async () => {
    // The operator refunds at the provider and records the reference days later. Judging the window again at that point
    // stranded the note: `refund_already_requested` blocked a second one and `refund_window_closed` blocked this one.
    const paid = await paidWithCreditNote(new Date(Date.now() - 3 * 86_400_000).toISOString(), 'vendor', false)
    const requested = (await requestRefund(paid.invoice.id))!
    expect(requested.status).toBe(201)
    const noteId = (requested.data as { id: string }).id
    // The window closes: the payment ages to day 20 and the vendor then also shortens the window to nothing.
    const old = new Date(Date.now() - 20 * 86_400_000).toISOString()
    await pool.query('UPDATE payment_attempts SET succeeded_at=$2,updated_at=$2 WHERE invoice_id=$1', [paid.invoice.id, old])
    await setBillingSettings(pool, { operator: 'vendor:7', reason: 'Release 1 billing settings', refund_window_days: 0 })
    expect(await refundEligibility(pool, paid.customer_id, paid.invoice.id)).toMatchObject({ refundable: false })
    await expect(ask(noteId)).resolves.toMatchObject({ status: 'refunded', origin: 'vendor' })
    // A request made now is still refused at creation, on another invoice (this one already has its note).
    const late = await paidWithCreditNote(old, 'vendor', false)
    await expect(requestRefund(late.invoice.id)).rejects.toMatchObject({ status: 409, code: 'refund_window_closed' })
  })

  it('records a vendor note whatever the age of the payment: recording is structural only', async () => {
    const paid = await paidWithCreditNote(new Date(Date.now() - 20 * 86_400_000).toISOString())
    await expect(ask(paid.noteId!)).resolves.toMatchObject({ status: 'refunded' })
  })

  it('two simultaneous refund requests on one invoice make exactly one note and one structured 409', async () => {
    const paid = await paidWithCreditNote(new Date().toISOString(), 'vendor', false)
    const results = await Promise.allSettled([requestRefund(paid.invoice.id), requestRefund(paid.invoice.id)])
    const won = results.filter(r => r.status === 'fulfilled')
    const lost = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    expect(won).toHaveLength(1)
    expect(lost).toHaveLength(1)
    expect(lost[0]!.reason).toMatchObject({ status: 409, code: 'refund_already_requested' })
    expect((await pool.query("SELECT count(*)::int AS n FROM invoice_adjustments WHERE invoice_id=$1 AND origin='vendor' AND status='pending'", [paid.invoice.id])).rows[0].n).toBe(1)
  })

  it('never refunds a refund already made, and keeps the window length a vendor-editable value', async () => {
    const paid = await paidWithCreditNote(new Date().toISOString(), 'vendor', false)
    await requestRefund(paid.invoice.id)
    const settings = await billingSettings(pool)
    expect(settings.refund_window_days).toBe(14)
    await setBillingSettings(pool, { operator: 'vendor:7', reason: 'Release 1 billing settings', refund_window_days: 0 })
    const closed = await paidWithCreditNote(new Date().toISOString(), 'vendor', false)
    await expect(requestRefund(closed.invoice.id)).rejects.toMatchObject({ code: 'refund_window_closed' })
  })

  it('refuses a partial credit note: only a full refund of the invoice is recorded', async () => {
    const { noteId, invoice } = await paidWithCreditNote(new Date().toISOString())
    await pool.query('UPDATE invoice_adjustments SET amount_minor=$2 WHERE id=$1', [noteId!, Number(invoice.total_minor) - 1])
    await expect(ask(noteId!)).rejects.toMatchObject({ status: 409, code: 'refund_not_full' })
    expect((await pool.query('SELECT status FROM invoice_adjustments WHERE id=$1', [noteId!])).rows[0].status).toBe('pending')
  })

  it('refuses a second vendor refund of one invoice, but each system note refunds once', async () => {
    const { invoice, customer_id } = await paidWithCreditNote(new Date().toISOString())
    const first = (await pool.query("SELECT id FROM invoice_adjustments WHERE invoice_id=$1 AND origin='vendor'", [invoice.id])).rows[0]
    await ask(first.id)
    // A4: the once-per-invoice rule is the customer-requested (vendor) refund. A second VENDOR note is refused...
    const secondVendor = randomUUID()
    await pool.query(`INSERT INTO invoice_adjustments(id,invoice_id,customer_id,kind,reason,amount_minor,currency,exponent,status,created_by,origin)
      VALUES($1,$2,$3,'credit_note','Second vendor note',$4,'SAR',2,'pending','vendor:7','vendor')`, [secondVendor, invoice.id, customer_id, invoice.total_minor])
    await expect(ask(secondVendor)).rejects.toMatchObject({ status: 409, code: 'invoice_already_refunded' })
    // ...while a system note (a duplicate charge) is keyed by its own charge and may be refunded.
    const systemNote = randomUUID()
    await pool.query(`INSERT INTO invoice_adjustments(id,invoice_id,customer_id,kind,reason,amount_minor,currency,exponent,status,created_by,origin)
      VALUES($1,$2,$3,'credit_note','Second note',$4,'SAR',2,'pending','system','system')`, [systemNote, invoice.id, customer_id, invoice.total_minor])
    await expect(ask(systemNote)).resolves.toMatchObject({ status: 'refunded' })
  })

  it('lets a system-created credit note be refunded outside the window', async () => {
    // A5: a duplicate charge on day 20 is money the customer never planned to spend; the window must not strand it.
    const old = await paidWithCreditNote(new Date(Date.now() - 20 * 86_400_000).toISOString(), 'system')
    await expect(ask(old.noteId!)).resolves.toMatchObject({ status: 'refunded', origin: 'system' })
    // The same age as a customer REQUEST is refused, at creation: that is the owner's rule.
    const requested = await paidWithCreditNote(new Date(Date.now() - 20 * 86_400_000).toISOString(), 'vendor', false)
    await expect(requestRefund(requested.invoice.id)).rejects.toMatchObject({ code: 'refund_window_closed' })
  })

  it('measures the window from the immutable success time, not from a later touch', async () => {
    const paid = await paidWithCreditNote(new Date(Date.now() - 3 * 86_400_000).toISOString())
    // Reconciliation and sibling cancellation rewrite updated_at; succeeded_at must not move with it.
    await pool.query("UPDATE payment_attempts SET updated_at=now() + interval '30 days' WHERE order_id=$1", [paid.order.id])
    const eligibility = await refundEligibility(pool, paid.customer_id, paid.invoice.id)
    expect(eligibility).toMatchObject({ refundable: true, first_payment: true })
  })

  /** A2: the route itself, exercised the way the proxy calls it — never by inserting a note. */
  const requestRefund = (invoiceId: string, over: Record<string, unknown> = {}) => routesB(pool,
    { method: 'POST', pathname: `/v1/commercial/invoices/${invoiceId}/refund-request`, raw: JSON.stringify({ reason: 'Customer asked within the window', ...over }),
      issuer: 'refund-route-test', actor: 7, capabilities: ['vendor.billing.manage'], stepUpFresh: true },
    new URL('http://localhost/v1/commercial'))

  it('the refund route creates the pending vendor note for the full total of an eligible invoice', async () => {
    const paid = await paidWithCreditNote(new Date().toISOString(), 'vendor', false)
    const answer = (await requestRefund(paid.invoice.id))!
    expect(answer.status).toBe(201)
    expect(answer.data).toMatchObject({ invoice_id: paid.invoice.id, status: 'pending', kind: 'credit_note' })
    expect(answer.data.amount).toMatchObject({ minor: Number(paid.invoice.total_minor), currency: paid.invoice.currency })
    const note = (await pool.query("SELECT * FROM invoice_adjustments WHERE invoice_id=$1 AND origin='vendor'", [paid.invoice.id])).rows[0]
    expect(note).toMatchObject({ status: 'pending', kind: 'credit_note' })
    expect(Number(note.amount_minor)).toBe(Number(paid.invoice.total_minor))
    // And the note it created is what the existing record-refund flow closes.
    const recorded = await refundCreditNote(pool, { adjustment_id: note.id, actor, request: { external_reference: `MOY-${randomUUID().slice(0, 8)}`, reason: 'Refunded at the provider' } })
    expect(recorded).toMatchObject({ status: 'refunded' })
  })

  it('the refund route refuses a closed window with its own code', async () => {
    const paid = await paidWithCreditNote(new Date(Date.now() - 15 * 86_400_000).toISOString(), 'vendor', false)
    await expect(requestRefund(paid.invoice.id)).rejects.toMatchObject({ status: 409, code: 'refund_window_closed' })
    expect((await pool.query('SELECT count(*)::int AS n FROM invoice_adjustments WHERE invoice_id=$1', [paid.invoice.id])).rows[0].n).toBe(0)
  })

  it('the refund route refuses a payment that is not the customer\'s first', async () => {
    // The customer's first payment paid `paid`'s invoice; the renewal invoice below is a later payment, so it is never
    // refundable — the owner's rule is first payment only.
    const paid = await paidWithCreditNote(new Date().toISOString(), 'vendor', false)
    const laterOrder = randomUUID()
    await pool.query(`INSERT INTO orders(id,customer_id,subscription_id,kind,quote_id,target_revision_id,payment_state,fulfillment_state,effective_at,idempotency_key,request_digest,due_now_minor,currency,exponent)
      SELECT $1,customer_id,subscription_id,'renewal',gen_random_uuid(),target_revision_id,'paid','applied',now()+interval '30 days',$2,'d',$3,currency,exponent FROM orders WHERE id=(SELECT order_id FROM invoices WHERE id=$4)`,
      [laterOrder, `k-${laterOrder}`, paid.invoice.total_minor, paid.invoice.id])
    const laterInvoice = randomUUID()
    await pool.query(`INSERT INTO invoices(id,number,customer_id,subscription_id,order_id,kind,status,currency,exponent,subtotal_minor,tax_minor,total_minor,period_start,period_end,paid_at,issued_at)
      SELECT $1,'INV-R',customer_id,subscription_id,$2,'renewal','paid',currency,exponent,subtotal_minor,0,total_minor,current_date,current_date+30,now(),now() FROM invoices WHERE id=$3`,
      [laterInvoice, laterOrder, paid.invoice.id])
    await pool.query(`INSERT INTO payment_attempts(id,order_id,invoice_id,provider,mode,provider_ref,amount_minor,currency,exponent,status,succeeded_at)
      SELECT $1,$2,$3,'moyasar','live',$4,total_minor,currency,exponent,'succeeded',now()+interval '30 days' FROM invoices WHERE id=$3`,
      [randomUUID(), laterOrder, laterInvoice, `moy-${laterOrder.slice(0, 8)}`])
    await expect(requestRefund(laterInvoice)).rejects.toMatchObject({ status: 409, code: 'refund_not_first_payment' })
    // The first invoice is still refundable, so the refusal is about which payment, not about the customer.
    // The route answers `{status, data}`, so the note's own state is in `data`.
    await expect(requestRefund(paid.invoice.id)).resolves.toMatchObject({ status: 201, data: { status: 'pending' } })
  })

  it('the refund route refuses a second note for the same invoice and an unpaid invoice', async () => {
    const paid = await paidWithCreditNote(new Date().toISOString(), 'vendor', false)
    await requestRefund(paid.invoice.id)
    // Already requested: no second vendor note (the unique index would refuse it, this says why).
    await expect(requestRefund(paid.invoice.id)).rejects.toMatchObject({ status: 409, code: 'refund_already_requested' })
    expect((await pool.query("SELECT count(*)::int AS n FROM invoice_adjustments WHERE invoice_id=$1 AND origin='vendor'", [paid.invoice.id])).rows[0].n).toBe(1)
    // An unpaid invoice has no payment to return. (An invoice that was paid can never go back to issued — the guard
    // refuses that transition — so this is a fresh issued invoice, not a reversed one.)
    const unpaid = randomUUID()
    await pool.query(`INSERT INTO invoices(id,number,customer_id,subscription_id,order_id,kind,status,currency,exponent,subtotal_minor,tax_minor,total_minor,period_start,period_end)
      SELECT $1,'INV-U',customer_id,subscription_id,order_id,'initial','issued',currency,exponent,100,0,100,current_date,current_date+30 FROM invoices WHERE id=$2`,
      [unpaid, paid.invoice.id])
    await expect(requestRefund(unpaid)).rejects.toMatchObject({ status: 409, code: 'invoice_not_paid' })
  })

  it('the refund route requires the billing capability and a fresh step-up', async () => {
    const paid = await paidWithCreditNote(new Date().toISOString(), 'vendor', false)
    const call = (caps: any[], stepUpFresh: boolean) => routesB(pool,
      { method: 'POST', pathname: `/v1/commercial/invoices/${paid.invoice.id}/refund-request`,
        raw: JSON.stringify({ reason: 'Customer asked within the window' }), issuer: 'refund-route-test', actor: 7, capabilities: caps, stepUpFresh },
      new URL('http://localhost/v1/commercial'))
    await expect(call(['vendor.subscriptions.manage'], true)).rejects.toMatchObject({ status: 403, code: 'forbidden' })
    await expect(call(['vendor.billing.manage'], false)).rejects.toMatchObject({ status: 403, code: 'step_up_required' })
    expect((await pool.query('SELECT count(*)::int AS n FROM invoice_adjustments WHERE invoice_id=$1', [paid.invoice.id])).rows[0].n).toBe(0)
  })

  it('two duplicate transfers on one invoice are both refundable, while a vendor full refund is refused twice', async () => {
    // A4: the old unique index allowed one refunded note per invoice, so the second duplicate's money was stuck.
    const paid = await paidWithCreditNote(new Date().toISOString(), 'vendor', false)
    const duplicate = async () => {
      const noteId = randomUUID()
      await pool.query(`INSERT INTO invoice_adjustments(id,invoice_id,customer_id,kind,reason,amount_minor,currency,exponent,status,created_by,origin)
        VALUES($1,$2,$3,'credit_note','duplicate payment — manual review',$4,$5,$6,'pending','system','system')`,
      [noteId, paid.invoice.id, paid.customer_id, paid.invoice.total_minor, paid.invoice.currency, paid.invoice.exponent])
      return noteId
    }
    const one = await duplicate(), two = await duplicate()
    await expect(ask(one)).resolves.toMatchObject({ status: 'refunded' })
    await expect(ask(two)).resolves.toMatchObject({ status: 'refunded' })
    // Both system notes are refunded; the invoice's vendor refund is still allowed once, and only once.
    const vendor = await requestRefund(paid.invoice.id)
    const vendorNote = (await pool.query("SELECT id FROM invoice_adjustments WHERE invoice_id=$1 AND origin='vendor'", [paid.invoice.id])).rows[0]
    await expect(ask(vendorNote.id)).resolves.toMatchObject({ status: 'refunded' })
    void vendor
    const second = randomUUID()
    await pool.query(`INSERT INTO invoice_adjustments(id,invoice_id,customer_id,kind,reason,amount_minor,currency,exponent,status,created_by,origin)
      VALUES($1,$2,$3,'credit_note','Second vendor note',$4,$5,$6,'pending','vendor:7','vendor')`,
    [second, paid.invoice.id, paid.customer_id, paid.invoice.total_minor, paid.invoice.currency, paid.invoice.exponent])
    await expect(ask(second)).rejects.toMatchObject({ status: 409, code: 'invoice_already_refunded' })
  })

  it('the system-origin paths still refund outside the window through the route\'s own note', async () => {
    // The route is the vendor path; a duplicate charge recorded by the system on the same old invoice still refunds.
    const old = await paidWithCreditNote(new Date(Date.now() - 20 * 86_400_000).toISOString(), 'vendor', false)
    await expect(requestRefund(old.invoice.id)).rejects.toMatchObject({ code: 'refund_window_closed' })
    const system = randomUUID()
    await pool.query(`INSERT INTO invoice_adjustments(id,invoice_id,customer_id,kind,reason,amount_minor,currency,exponent,status,created_by,origin)
      VALUES($1,$2,$3,'credit_note','duplicate payment — manual review',$4,$5,$6,'pending','system','system')`,
    [system, old.invoice.id, old.customer_id, old.invoice.total_minor, old.invoice.currency, old.invoice.exponent])
    await expect(ask(system)).resolves.toMatchObject({ status: 'refunded' })
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
