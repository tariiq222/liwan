import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import { migrate } from '../db.js'
import { issueInvoiceFromQuote, getInvoice, listInvoices } from '../commercial/invoices.js'
import { enqueueOutbox, claimOutbox, completeOutbox } from '../commercial/outbox.js'

const url = process.env.CONTROL_TEST_DATABASE_URL
if (url) { const p = new URL(url); if (!['127.0.0.1', 'localhost', '::1'].includes(p.hostname) || !/^nasq_control_scratch_[a-z0-9]+$/.test(p.pathname.slice(1))) throw Error('scratch control DB required') }
const suite = url ? describe : describe.skip
const m = (minor: number) => ({ currency: 'SAR', exponent: 2, minor })

suite('commercial billing invoices + outbox', () => {
  const pool = new Pool({ connectionString: url, max: 4 })
  async function seed() {
    const customer = randomUUID(), sub = randomUUID(), order = randomUUID(), quote = randomUUID()
    await pool.query('INSERT INTO customers(id,name) VALUES($1,$2)', [customer, 'Cust'])
    await pool.query('INSERT INTO subscriptions(id,customer_id) VALUES($1,$2)', [sub, customer])
    const rid = randomUUID()
    await pool.query("INSERT INTO subscription_revisions(id,subscription_id,revision,snapshot,quote_id) VALUES($1,$2,1,'{}',$3)", [rid, sub, quote])
    await pool.query(`INSERT INTO orders(id,customer_id,subscription_id,kind,quote_id,target_revision_id,payment_state,fulfillment_state,idempotency_key,request_digest,due_now_minor,currency,exponent)
      VALUES($1,$2,$3,'new',$4,$5,'awaiting_payment','not_started',$6,'d',115000,'SAR',2)`, [order, customer, sub, quote, rid, randomUUID()])
    return { order: { id: order, customer_id: customer, subscription_id: sub, kind: 'new' }, rid }
  }
  const mkQuote = (rid: string, dueNow = 115000, tax = 15000): any => ({
    effective_date: '2026-01-01', next_renewal_at: '2026-02-01', due_now: m(dueNow), next_renewal: m(dueNow),
    lines: [
      { key: 'base', kind: 'base', timing: 'now', description: 'Base', quantity: 1, amount: m(0), period_start: '2026-01-01', period_end: '2026-02-01', source_revision_id: rid },
      { key: 'branch', kind: 'branch', timing: 'now', description: 'Branches', quantity: 2, amount: m(100000), period_start: '2026-01-01', period_end: '2026-02-01', source_revision_id: rid },
      { key: 'tax', kind: 'tax', timing: 'now', description: 'VAT', quantity: 1, amount: m(tax), period_start: '2026-01-01', period_end: '2026-02-01', source_revision_id: rid },
      { key: 'next', kind: 'base', timing: 'renewal', description: 'Next', quantity: 1, amount: m(5), period_start: '2026-02-01', period_end: '2026-03-01', source_revision_id: rid },
    ],
  })
  beforeAll(async () => { await migrate(pool) })
  afterAll(async () => { await pool.end() })

  it('issues invoices with unique numbers and immutable lines', async () => {
    const a = await seed(), b = await seed()
    const c = await pool.connect()
    let ia, ib
    try { ia = await issueInvoiceFromQuote(c, { order: a.order, quote: mkQuote(a.rid) }); ib = await issueInvoiceFromQuote(c, { order: b.order, quote: mkQuote(b.rid) }) } finally { c.release() }
    expect(ia!.number).toMatch(/^NSQ-\d{4}-\d{6}$/)
    expect(ia!.number).not.toBe(ib!.number)
    expect(ia).toMatchObject({ kind: 'initial', status: 'issued', official_tax_invoice: false, subtotal: m(100000), tax: m(15000), total: m(115000) })
    expect(ia!.lines).toHaveLength(3)
    expect(ia!.lines[1]).toMatchObject({ quantity: 2, unit_amount: m(50000) })
    await expect(pool.query('UPDATE invoice_lines SET description=$1 WHERE invoice_id=$2', ['x', ia!.id])).rejects.toThrow(/immutable/)
    expect((await listInvoices(pool, { customer_id: a.order.customer_id })).total).toBe(1)
  })
  it('zero due returns null; mismatch throws', async () => {
    const a = await seed()
    const c = await pool.connect()
    try {
      expect(await issueInvoiceFromQuote(c, { order: a.order, quote: mkQuote(a.rid, 0, 0) })).toBeNull()
      await expect(issueInvoiceFromQuote(c, { order: a.order, quote: mkQuote(a.rid, 999, 15000) })).rejects.toThrow('invoice_total_mismatch')
    } finally { c.release() }
  })
  it('customer-scoped getInvoice hides other customers', async () => {
    const a = await seed(), other = await seed()
    const c = await pool.connect()
    let inv
    try { inv = await issueInvoiceFromQuote(c, { order: a.order, quote: mkQuote(a.rid) }) } finally { c.release() }
    expect(await getInvoice(pool, inv!.id, { customer_id: a.order.customer_id })).toMatchObject({ id: inv!.id })
    expect(await getInvoice(pool, inv!.id, { customer_id: other.order.customer_id })).toBeNull()
  })
  it('outbox dedupes, claims and completes', async () => {
    const agg = randomUUID(), kind = `t-${agg}`
    expect(await enqueueOutbox(pool as any, { kind, aggregate_id: agg, dedupe_key: 'k', payload: { a: 1 } })).toBe(true)
    expect(await enqueueOutbox(pool as any, { kind, aggregate_id: agg, dedupe_key: 'k', payload: { a: 2 } })).toBe(false)
    const rows = await claimOutbox(pool, [kind], 10)
    expect(rows).toHaveLength(1)
    await completeOutbox(pool, rows[0]!.id)
    expect(await claimOutbox(pool, [kind], 10)).toHaveLength(0)
  })
})
