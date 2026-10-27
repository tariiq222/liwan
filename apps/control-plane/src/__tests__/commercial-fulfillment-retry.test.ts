import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import { url, setup, client } from './commercial-helpers.js'
import { failEnqueueTerminally, failFulfillment, failFulfillmentOn, processFulfillmentOutbox } from '../commercial/fulfillment.js'
import { completeOutbox, deferOutbox, failOutbox } from '../commercial/outbox.js'

const suite = url ? describe : describe.skip
suite('fulfillment enqueue retry on scratch PostgreSQL', () => {
  const pool = new Pool({ connectionString: url, max: 8 })
  // No shared runtime configuration: onboarding refuses with shared_adapter_unavailable (transient).
  const enrollment = { config: {} as any }
  let release: string
  beforeAll(async () => {
    const { version } = await setup(pool)
    release = (await client(pool)('POST', '/catalog/releases', { catalog_version: version, reason: 'Retry regression' })).body.id
  })
  afterAll(async () => { await pool.end() })

  async function seed(opts: { payment?: string; catalogRelease?: string; invoice?: boolean } = {}) {
    const customer = randomUUID(), subscription = randomUUID(), target = randomUUID(), order = randomUUID()
    await pool.query('INSERT INTO customers(id,name,admin_name,admin_login) VALUES($1,$2,$3,$4)', [customer, 'Retry customer', 'Admin', `${customer}@example.test`])
    await pool.query('INSERT INTO subscriptions(id,customer_id) VALUES($1,$2)', [subscription, customer])
    const entitlement = { catalog_release_id: opts.catalogRelease ?? release, modules: ['webvue_core'], features: {}, digest: 'a'.repeat(64), compiler_version: 1 }
    await pool.query('INSERT INTO subscription_revisions(id,subscription_id,revision,snapshot,quote_id) VALUES($1,$2,1,$3,$4)', [target, subscription, { entitlement, period_end: '2027-01-01' }, randomUUID()])
    await pool.query('UPDATE subscriptions SET target_revision_id=$2,revision=revision+1 WHERE id=$1', [subscription, target])
    await pool.query("INSERT INTO orders(id,customer_id,subscription_id,kind,quote_id,target_revision_id,payment_state,fulfillment_state,idempotency_key,request_digest,due_now_minor,currency,exponent) VALUES($1,$2,$3,'new',$4,$5,$6,'queued',$7,'test',100,'SAR',2)", [order, customer, subscription, randomUUID(), target, opts.payment ?? 'paid', randomUUID()])
    await pool.query("INSERT INTO commercial_outbox(id,kind,aggregate_id,dedupe_key) VALUES($1,'fulfillment.enqueue',$2,$3)", [randomUUID(), order, target])
    if (opts.invoice !== false) await pool.query("INSERT INTO invoices(id,customer_id,subscription_id,order_id,kind,status,currency,exponent,subtotal_minor,tax_minor,total_minor,period_start,period_end) VALUES($1,$2,$3,$4,'initial','paid','SAR',2,100,15,115,'2026-01-01','2027-01-01')", [randomUUID(), customer, subscription, order])
    return { customer, subscription, order, target }
  }
  const run = () => processFulfillmentOutbox(pool, { enrollment })
  const row = async (order: string) => (await pool.query('SELECT status,attempts,next_attempt_at > now() AS waiting,payload FROM commercial_outbox WHERE aggregate_id=$1', [order])).rows[0]
  const orderState = async (order: string) => (await pool.query('SELECT fulfillment_state FROM orders WHERE id=$1', [order])).rows[0].fulfillment_state
  const notes = async (order: string) => (await pool.query("SELECT a.status FROM invoice_adjustments a JOIN invoices i ON i.id=a.invoice_id WHERE i.order_id=$1 AND a.kind='credit_note'", [order])).rows
  const invoiceStatus = async (order: string) => (await pool.query('SELECT status FROM invoices WHERE order_id=$1', [order])).rows[0].status

  it('defers a transient error with backoff and picks the row up again only when due', async () => {
    const s = await seed()
    expect(await run()).toContainEqual({ order_id: s.order, reason: 'shared_adapter_unavailable' })
    expect(await row(s.order)).toMatchObject({ status: 'pending', attempts: 1, waiting: true, payload: { error: 'shared_adapter_unavailable' } })
    expect(await run()).not.toContainEqual(expect.objectContaining({ order_id: s.order }))
    expect((await row(s.order)).attempts).toBe(1)
    await pool.query("UPDATE commercial_outbox SET next_attempt_at=now() WHERE aggregate_id=$1", [s.order])
    expect(await run()).toContainEqual({ order_id: s.order, reason: 'shared_adapter_unavailable' })
    expect(await row(s.order)).toMatchObject({ status: 'pending', attempts: 2, waiting: true })
    expect(await orderState(s.order)).toBe('queued')
    expect(await notes(s.order)).toHaveLength(0)
  })

  it('caps the backoff at 60 minutes', async () => {
    const s = await seed({ invoice: false })
    await pool.query('UPDATE commercial_outbox SET attempts=8 WHERE aggregate_id=$1', [s.order])
    const id = (await pool.query('SELECT id FROM commercial_outbox WHERE aggregate_id=$1', [s.order])).rows[0].id
    await deferOutbox(pool, id, 'x')
    const wait = (await pool.query("SELECT extract(epoch FROM next_attempt_at - now())/60 AS minutes FROM commercial_outbox WHERE id=$1", [id])).rows[0].minutes
    expect(Number(wait)).toBeGreaterThan(59); expect(Number(wait)).toBeLessThanOrEqual(60)
  })

  it('fails the order with one pending credit note after the last transient attempt', async () => {
    const s = await seed()
    await pool.query('UPDATE commercial_outbox SET attempts=9 WHERE aggregate_id=$1', [s.order])
    await run()
    expect(await orderState(s.order)).toBe('failed')
    expect(await invoiceStatus(s.order)).toBe('credit_pending')
    expect(await notes(s.order)).toEqual([{ status: 'pending' }])
    expect(await row(s.order)).toMatchObject({ status: 'failed', payload: { error: 'retries_exhausted: shared_adapter_unavailable' } })
  })

  it('fails a permanent error at once with a credit note', async () => {
    const s = await seed({ catalogRelease: randomUUID() })
    expect(await run()).toContainEqual({ order_id: s.order, reason: 'enrollment_base_catalog_missing' })
    expect(await orderState(s.order)).toBe('failed')
    expect(await invoiceStatus(s.order)).toBe('credit_pending')
    expect(await notes(s.order)).toHaveLength(1)
    expect(await row(s.order)).toMatchObject({ status: 'failed', attempts: 0 })
  })

  it('leaves an unreleased order alone and creates no credit note', async () => {
    const s = await seed({ payment: 'awaiting_payment' })
    expect(await run()).toContainEqual({ order_id: s.order, reason: 'order_not_released' })
    expect(await row(s.order)).toMatchObject({ status: 'failed' })
    expect(await orderState(s.order)).toBe('queued')
    expect(await notes(s.order)).toHaveLength(0)
  })

  it('sends a stale target to needs_intervention without a credit note', async () => {
    const s = await seed()
    await pool.query('UPDATE subscriptions SET target_revision_id=NULL,revision=revision+1 WHERE id=$1', [s.subscription])
    expect(await run()).toContainEqual({ order_id: s.order, reason: 'stale_target' })
    expect(await orderState(s.order)).toBe('needs_intervention')
    expect(await invoiceStatus(s.order)).toBe('paid')
    expect(await notes(s.order)).toHaveLength(0)
    expect(await row(s.order)).toMatchObject({ status: 'failed' })
  })

  it('gives one credit note when the terminal step runs twice', async () => {
    const s = await seed()
    await failFulfillment(pool, { order_id: s.order, code: 'idempotency_conflict' })
    await failFulfillment(pool, { order_id: s.order, code: 'idempotency_conflict' })
    expect(await notes(s.order)).toHaveLength(1)
    // An order already in needs_intervention is left as it is instead of throwing.
    const t = await seed()
    await failFulfillment(pool, { order_id: t.order, code: 'stale_target' })
    await failFulfillment(pool, { order_id: t.order, code: 'stale_target' })
    expect(await orderState(t.order)).toBe('needs_intervention')
  })

  it('never enqueues work for a finished order and never reopens a finished row', async () => {
    const s = await seed()
    await pool.query("UPDATE orders SET fulfillment_state='failed' WHERE id=$1", [s.order])
    expect(await run()).toContainEqual({ order_id: s.order, reason: 'order_failed' })
    expect(await row(s.order)).toMatchObject({ status: 'failed' })
    expect((await pool.query('SELECT enrollment_request_id FROM customers WHERE id=$1', [s.customer])).rows[0].enrollment_request_id).toBeNull()

    const d = await seed({ invoice: false })
    const id = (await pool.query('SELECT id FROM commercial_outbox WHERE aggregate_id=$1', [d.order])).rows[0].id
    await completeOutbox(pool, id)
    await failOutbox(pool, id, 'late'); await deferOutbox(pool, id, 'late'); await completeOutbox(pool, id)
    expect(await row(d.order)).toMatchObject({ status: 'done', attempts: 0 })
  })

  it('migration 028 re-queues failed enqueue rows of orders that still wait', async () => {
    const waiting = await seed({ invoice: false }), done = await seed({ invoice: false })
    await pool.query("UPDATE orders SET fulfillment_state='applied' WHERE id=$1", [done.order])
    await pool.query("UPDATE commercial_outbox SET status='failed',processed_at=now(),attempts=3 WHERE aggregate_id = ANY($1)", [[waiting.order, done.order]])
    const sql = (await import('node:fs/promises')).readFile(new URL('../schema_028.sql', import.meta.url), 'utf8')
    const requeue = (await sql).slice((await sql).indexOf('UPDATE commercial_outbox'))
    await pool.query(requeue)
    expect(await row(waiting.order)).toMatchObject({ status: 'pending', attempts: 0, waiting: false })
    expect(await row(done.order)).toMatchObject({ status: 'failed', attempts: 3 })
  })

  it('two workers holding the same expired claim give one terminal failure', async () => {
    const s = await seed({ catalogRelease: randomUUID() })
    const claimed = (await pool.query('SELECT * FROM commercial_outbox WHERE aggregate_id=$1', [s.order])).rows[0]
    // Both workers hold the same row, as after a lease expiry; only the row lock can pick one outcome.
    const sameClaim = { connect: pool.connect.bind(pool), query: (sql: string, params?: unknown[]) => /^\s*WITH due AS/.test(sql) ? Promise.resolve({ rows: [claimed] }) : pool.query(sql, params as any[]) } as unknown as Pool
    await Promise.all([processFulfillmentOutbox(sameClaim, { enrollment }), processFulfillmentOutbox(sameClaim, { enrollment })])
    expect(await orderState(s.order)).toBe('failed')
    expect(await notes(s.order)).toHaveLength(1)
    expect(await row(s.order)).toMatchObject({ status: 'failed' })
    expect((await pool.query("SELECT count(*)::int AS n FROM shared_jobs j JOIN subscriptions s ON s.tenant_id=j.control_tenant_id WHERE s.id=$1", [s.subscription])).rows[0].n).toBe(0)
  })

  it('the terminal step from two connections gives one credit note and no job', async () => {
    const s = await seed()
    const outbox = (await pool.query('SELECT * FROM commercial_outbox WHERE aggregate_id=$1', [s.order])).rows[0]
    const a = await pool.connect()
    try {
      // Connection A is inside its terminal transaction when B starts.
      await a.query('BEGIN')
      expect((await a.query("SELECT id FROM commercial_outbox WHERE id=$1 AND status='pending' FOR UPDATE", [outbox.id])).rowCount).toBe(1)
      await failFulfillmentOn(a, { order_id: s.order, code: 'idempotency_conflict' })
      await failOutbox(a, outbox.id, 'idempotency_conflict')
      const b = failEnqueueTerminally(pool, outbox, 'idempotency_conflict')
      const blocked = await Promise.race([b.then(() => 'finished'), new Promise(r => setTimeout(() => r('waiting'), 300))])
      expect(blocked).toBe('waiting')
      await a.query('COMMIT')
      await b
    } finally { a.release() }
    expect(await notes(s.order)).toHaveLength(1)
    expect(await orderState(s.order)).toBe('failed')
    expect(await row(s.order)).toMatchObject({ status: 'failed' })
    expect((await pool.query('SELECT count(*)::int AS n FROM fulfillment_effects WHERE order_id=$1', [s.order])).rows[0].n).toBe(0)
  })

  it('records the cause when failure handling itself fails, and keeps the row pending', async () => {
    const s = await seed({ catalogRelease: randomUUID() })
    // A refund lands between the attempt and the terminal step: the order is no longer fulfillable.
    const claimed = (await pool.query('SELECT * FROM commercial_outbox WHERE aggregate_id=$1', [s.order])).rows[0]
    const refund = {
      query: (sql: string, params?: unknown[]) => /^\s*WITH due AS/.test(sql) ? Promise.resolve({ rows: [claimed] }) : pool.query(sql, params as any[]),
      connect: async () => {
        const c = await pool.connect(), original = c.query, release = c.release
        c.query = (async (sql: any, params: any) => {
          if (typeof sql === 'string' && /commercial_outbox WHERE id=\$1 AND status='pending' FOR UPDATE/.test(sql)) await pool.query("UPDATE orders SET payment_state='refund_pending' WHERE id=$1", [s.order])
          return (original as any).call(c, sql, params)
        }) as any
        c.release = ((e?: any) => { c.query = original; c.release = release; return release.call(c, e) }) as any
        return c
      },
    } as unknown as Pool
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(await processFulfillmentOutbox(refund, { enrollment })).toContainEqual({ order_id: s.order, reason: expect.any(String) })
      expect(logged).toHaveBeenCalledWith(expect.stringContaining('failure handling failed'))
    } finally { logged.mockRestore() }
    const r = await row(s.order)
    expect(r.status).toBe('pending')
    expect(String(r.payload.error)).toMatch(/^failure_handling_failed: enrollment_base_catalog_missing; .*invalid_order_transition/)
  })
})
