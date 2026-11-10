import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Pool } from 'pg'
import { riyadhDate } from '@liwan/commercial-contracts'
import { migrate } from '../db.js'
import { applyConfirmedEvent, createPaymentAttempt, handleProviderEvent, reconcileUnknownAttempts, verifyReturnedAttempt } from '../commercial/payments.js'
import { bankTransferInstructions, confirmBankTransfer } from '../commercial/bank-transfer.js'
import { processRefundOutbox } from '../commercial/settlements.js'
import { PaymentError, type ProviderEvent } from '../commercial/payment-adapter.js'
import { SimulatorAdapter } from '../commercial/payment-simulator.js'
import { claimForSend, getStoredChargeCollection, reconcileTokenCharges, sendTokenCharge } from '../commercial/token-charge.js'
import { url } from './commercial-helpers.js'

const suite = url ? describe : describe.skip

suite('stored-method charge engine', () => {
  const pool = new Pool({ connectionString: url })
  beforeAll(async () => { await migrate(pool) })
  afterAll(async () => { await pool.end() })

  async function fixture() {
    const customer = randomUUID(), subscription = randomUUID(), revision = randomUUID(), quote = randomUUID()
    const order = randomUUID(), invoice = randomUUID(), method = randomUUID(), notice = randomUUID(), attempt = randomUUID()
    await pool.query("INSERT INTO customers(id,name) VALUES($1,'Stored-method fixture')", [customer])
    await pool.query("INSERT INTO subscriptions(id,customer_id,state) VALUES($1,$2,'active')", [subscription,customer])
    await pool.query(`INSERT INTO subscription_revisions(id,subscription_id,revision,snapshot,quote_id) VALUES($1,$2,1,'{"cadence":{"unit":"month","count":1}}',$3)`, [revision,subscription,quote])
    await pool.query(`INSERT INTO orders(id,customer_id,subscription_id,kind,quote_id,target_revision_id,expected_applied_revision_id,
      payment_state,fulfillment_state,idempotency_key,request_digest,due_now_minor,currency,exponent)
      VALUES($1,$2,$3,'renewal',$4,$5,$5,'awaiting_payment','not_started',$6,'fixture',1000,'SAR',2)`, [order,customer,subscription,quote,revision,order])
    await pool.query(`INSERT INTO invoices(id,customer_id,subscription_id,order_id,kind,currency,exponent,subtotal_minor,tax_minor,total_minor,period_start,period_end,due_at)
      VALUES($1,$2,$3,$4,'renewal','SAR',2,1000,0,1000,'2026-10-01','2026-11-01',now()-interval '1 day')`, [invoice,customer,subscription,order])
    await pool.query(`INSERT INTO payment_methods(id,subscription_id,provider,state,token_ciphertext,key_id,consent_at,consent_actor,consent_version)
      VALUES($1,$2,'simulator','active',$3,'fixture-key','2026-09-01','fixture','fixture')`, [method,subscription,Buffer.from([1])])
    await pool.query(`INSERT INTO renewal_notices(id,subscription_id,method_id,renewal_date,cadence_unit,cadence_count,
      amount_minor,currency,exponent,state,sent_at)
      VALUES($1,$2,$3,'2026-10-01','month',1,1000,'SAR',2,'sent','2026-09-20')`, [notice,subscription,method])
    const reserve = (id: string, methodId: string | null = method) => pool.query(`INSERT INTO payment_attempts
      (id,order_id,invoice_id,provider,mode,amount_minor,currency,exponent,token_charge,method_id,notice_id)
      VALUES($1,$2,$3,'simulator','simulator',1000,'SAR',2,true,$4,$5)`, [id,order,invoice,methodId,notice])
    await reserve(attempt)
    const adapter = new SimulatorAdapter().addToken('fixture-token')
    const send = (clock?: () => number) => sendTokenCharge(pool, { attemptId: attempt, adapter, clock, openToken: () => 'fixture-token', callbackUrl: 'https://liwan.test/api/commercial/payment-callback' })
    const hosted = () => createPaymentAttempt(pool, { order_id: order, customer_id: customer, adapter, returnOrigin: async () => 'https://liwan.test' })
    const state = async () => (await pool.query('SELECT status,sent_at,resolved_at,closed_reason,provider_ref FROM payment_attempts WHERE id=$1',[attempt])).rows[0]
    const orderState = async () => (await pool.query('SELECT payment_state,paid_attempt_id FROM orders WHERE id=$1',[order])).rows[0]
    return { order, invoice, customer, attempt, adapter, reserve, send, hosted, state, orderState }
  }

  it('requires method evidence and preserves one attempt per invoice after it closes', async () => {
    const f = await fixture()
    await expect(f.reserve(randomUUID(), null)).rejects.toMatchObject({ constraint: 'payment_attempts_stored_charge_shape' })
    await pool.query("UPDATE payment_attempts SET status='canceled',closed_reason='unsent_expired',resolved_at=now() WHERE id=$1", [f.attempt])
    await expect(f.reserve(randomUUID())).rejects.toMatchObject({ constraint: 'payment_attempts_one_stored_charge' })
    const columns = (await pool.query(`SELECT column_name FROM information_schema.columns
      WHERE table_name='subscriptions' AND column_name='provider_token_ref'`)).rows
    expect(columns).toEqual([])
  })

  it('refuses the schema upgrade for historical payment records without printing credentials', async () => {
    const migration = await readFile(new URL('../schema_046.sql', import.meta.url), 'utf8')
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('CREATE TEMP TABLE subscriptions(auto_renew_enabled boolean,auto_renew_consent_at timestamptz,provider_token_ref text)')
      await client.query('CREATE TEMP TABLE payment_attempts(token_charge boolean)')
      for (const seed of ["INSERT INTO subscriptions VALUES(true,now(),'synthetic-legacy-value')", 'INSERT INTO payment_attempts VALUES(true)']) {
        await client.query('SAVEPOINT test_history')
        await client.query(seed)
        await expect(client.query(migration)).rejects.toMatchObject({ message: 'legacy_stored_payment_requires_reconciliation' })
        await client.query('ROLLBACK TO SAVEPOINT test_history')
      }
    } finally {
      await client.query('ROLLBACK')
      client.release()
    }
  })

  it('commits its send claim before making exactly one concurrent provider call', async () => {
    const f = await fixture()
    const realCharge = f.adapter.chargeToken.bind(f.adapter)
    const charge = vi.spyOn(f.adapter, 'chargeToken').mockImplementation(async input => {
      expect(await f.state()).toMatchObject({ status: 'unknown', sent_at: expect.any(Date) })
      return realCharge(input)
    })
    expect((await Promise.all(Array.from({ length: 5 }, () => f.send()))).filter(Boolean)).toHaveLength(1)
    expect(charge).toHaveBeenCalledTimes(1)
    expect(await f.state()).toMatchObject({ status: 'succeeded', resolved_at: expect.any(Date) })
    expect(await f.orderState()).toEqual({ payment_state: 'paid', paid_attempt_id: f.attempt })
    expect(await f.send()).toBe(false)
  })

  it('does not claim an attempt that expires while waiting for the order lock', async () => {
    const f = await fixture()
    const createdAt = (await pool.query('SELECT created_at FROM payment_attempts WHERE id=$1',[f.attempt])).rows[0].created_at as Date
    const deadline = createdAt.getTime() + 60 * 60_000
    let now = deadline - 1
    const charge = vi.spyOn(f.adapter, 'chargeToken')
    const holder = await pool.connect()
    let sending: Promise<boolean> | undefined
    try {
      await holder.query('BEGIN')
      await holder.query('SELECT id FROM orders WHERE id=$1 FOR UPDATE', [f.order])
      const holderPid = (await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
      sending = f.send(() => now)
      await expect.poll(async () => (await pool.query(`SELECT count(*)::int AS waiting FROM pg_stat_activity
        WHERE $1::integer=ANY(pg_blocking_pids(pid))`, [holderPid])).rows[0].waiting).toBe(1)
      now = deadline
    } finally {
      await holder.query('ROLLBACK')
      holder.release()
      if (sending) await Promise.allSettled([sending])
    }
    await expect(sending).resolves.toBe(false)
    expect(charge).not.toHaveBeenCalled()
    expect(await f.state()).toMatchObject({ status: 'created', sent_at: null })
  })

  function providerEvent(f: Awaited<ReturnType<typeof fixture>>): ProviderEvent {
    const providerRef = randomUUID()
    return { provider: f.adapter.provider, merchant_account: f.adapter.merchantAccount, live: false, event_id: randomUUID(),
      attempt_id: f.attempt, provider_ref: providerRef, payment_id: providerRef, status: 'succeeded',
      amount: { minor: 1000, currency: 'SAR', exponent: 2 }, occurred_at: new Date().toISOString(), raw_type: 'payment_paid' }
  }

  it('keeps a correlated provider reference after a failed authoritative read without paying', async () => {
    const f = await fixture()
    const event = providerEvent(f)
    const charge = vi.spyOn(f.adapter, 'chargeToken').mockResolvedValue({ ...event, status: 'pending' })
    const lookup = vi.spyOn(f.adapter, 'lookupPayment')
      .mockRejectedValueOnce(new PaymentError('provider_unreachable')).mockResolvedValue({ ...event, attempt_id: null })
    await f.send()
    expect(await f.state()).toMatchObject({ status: 'pending', provider_ref: event.provider_ref })
    expect(await f.orderState()).toEqual({ payment_state: 'awaiting_payment', paid_attempt_id: null })
    await reconcileTokenCharges(pool, f.adapter)
    expect(lookup.mock.calls.filter(([ref]) => ref === event.provider_ref)).toHaveLength(2)
    expect(await f.orderState()).toEqual({ payment_state: 'paid', paid_attempt_id: f.attempt })
    expect(await f.send()).toBe(false)
    expect(charge).toHaveBeenCalledTimes(1)
  })

  it('keeps no payment-event write lock during the stored webhook lookup and settles once', async () => {
    const f = await fixture()
    await claimForSend(pool, f.attempt)
    const event = providerEvent(f)
    vi.spyOn(f.adapter, 'verifyEvent').mockReturnValue(event)
    let release!: () => void
    const waiting = new Promise<void>(resolve => { release = resolve })
    const lookup = vi.spyOn(f.adapter, 'lookupPayment').mockImplementation(async () => {
      await waiting
      return { ...event, attempt_id: null }
    })
    const webhook = () => handleProviderEvent(pool, { provider: f.adapter.provider, rawBody: 'fixture', headers: {}, adapter: f.adapter })
    const responses = [webhook()]
    try {
      await expect.poll(() => lookup.mock.calls.length).toBe(1)
      const locks = (await pool.query(`SELECT count(*)::int AS writes FROM pg_locks
        WHERE relation='payment_events'::regclass AND mode='RowExclusiveLock' AND granted`)).rows[0].writes
      expect(locks).toBe(0)
      responses.push(webhook())
      await expect.poll(() => lookup.mock.calls.length).toBe(2)
    } finally {
      release()
      await Promise.allSettled(responses)
    }
    expect((await Promise.all(responses)).map(result => result.outcome).sort()).toEqual(['accepted','duplicate'])
    expect(await f.orderState()).toEqual({ payment_state: 'paid', paid_attempt_id: f.attempt })
    const events = (await pool.query('SELECT attempt_id,confirmed FROM payment_events WHERE provider_event_id=$1',[event.event_id])).rows
    expect(events).toEqual([{ attempt_id: f.attempt, confirmed: true }])
  })

  it('rejects a stored webhook when a different provider reference binds during its read', async () => {
    const f = await fixture()
    await claimForSend(pool, f.attempt)
    const event = providerEvent(f)
    vi.spyOn(f.adapter, 'verifyEvent').mockReturnValue(event)
    let release!: () => void
    const waiting = new Promise<void>(resolve => { release = resolve })
    const lookup = vi.spyOn(f.adapter, 'lookupPayment').mockImplementation(async () => { await waiting; return event })
    const response = handleProviderEvent(pool, { provider: f.adapter.provider, rawBody: 'fixture', headers: {}, adapter: f.adapter })
    const other = { ...providerEvent(f), status: 'pending' as const }
    try {
      await expect.poll(() => lookup.mock.calls.length).toBe(1)
      expect(await applyConfirmedEvent(pool, other)).toBe('accepted')
    } finally {
      release()
      await Promise.allSettled([response])
    }
    expect(await response).toMatchObject({ status: 200, outcome: 'rejected' })
    expect(await f.state()).toMatchObject({ status: 'pending', provider_ref: other.provider_ref })
    expect(await f.orderState()).toEqual({ payment_state: 'awaiting_payment', paid_attempt_id: null })
  })

  it('reads back a lost response by attempt id without resending', async () => {
    const f = await fixture()
    const charge = vi.spyOn(f.adapter.scriptCharge(f.attempt, 'lose_response'), 'chargeToken')
    expect(await f.send()).toBe(true)
    expect(await f.state()).toMatchObject({ status: 'unknown' })
    await reconcileTokenCharges(pool, f.adapter)
    expect(await f.state()).toMatchObject({ status: 'succeeded' })
    expect(await f.send()).toBe(false)
    expect(charge).toHaveBeenCalledTimes(1)
  })

  it('holds both manual paths for 24 hours after a crash and never resends on not-found', async () => {
    const f = await fixture()
    await claimForSend(pool, f.attempt)
    const sent = (await f.state()).sent_at as Date
    const resolveBy = new Date(sent.getTime() + 86_400_000).toISOString()
    const charge = vi.spyOn(f.adapter, 'chargeToken')
    const lookup = vi.spyOn(f.adapter, 'lookupPayment')
    await verifyReturnedAttempt(pool, { attempt_id: f.attempt, customer_id: f.customer, adapter: f.adapter })
    await reconcileUnknownAttempts(pool, f.adapter)
    expect(lookup).not.toHaveBeenCalled()
    await reconcileTokenCharges(pool, f.adapter, new Date(sent.getTime() + 86_399_999))
    expect(lookup).toHaveBeenCalledWith(f.attempt)
    expect(await f.state()).toMatchObject({ status: 'unknown' })
    expect(await f.send()).toBe(false)
    expect(charge).not.toHaveBeenCalled()
    const refusal = { status: 409, code: 'payment_charge_in_progress', details: { resolve_by: resolveBy } }
    await expect(f.hosted()).rejects.toMatchObject(refusal)
    await expect(bankTransferInstructions(pool, { invoice_id: f.invoice, customer_id: f.customer })).rejects.toMatchObject(refusal)
    expect(await getStoredChargeCollection(pool, f.order)).toEqual({ state: 'in_progress', resolve_by: resolveBy })
    await pool.query("UPDATE payment_attempts SET sent_at=now()-interval '24 hours 1 second' WHERE id=$1",[f.attempt])
    expect((await f.hosted()).status).toBe('redirected')
    expect(await f.state()).toMatchObject({ status: 'canceled', closed_reason: 'abandoned' })
    expect(await f.send()).toBe(false)
    expect(charge).not.toHaveBeenCalled()
  })

  it.each([['decline', 'failed', 'declined'], ['refuse', 'canceled', 'refused']] as const)(
    'closes %s without failing the order', async (outcome, status, reason) => {
      const f = await fixture()
      f.adapter.scriptCharge(f.attempt, outcome)
      await f.send()
      expect(await f.state()).toMatchObject({ status, closed_reason: reason, resolved_at: expect.any(Date) })
      expect(await f.orderState()).toEqual({ payment_state: 'awaiting_payment', paid_attempt_id: null })
      expect((await f.hosted()).status).toBe('redirected')
    },
  )

  it.each(['unsent', 'unavailable', 'pending', 'inactive'] as const)(
    'unblocks hosted collection without retrying an %s stored charge', async outcome => {
      const f = await fixture()
      if (outcome === 'inactive') f.adapter.addToken('fixture-token', 'inactive')
      if (outcome === 'unavailable' || outcome === 'pending') f.adapter.scriptCharge(f.attempt, outcome)
      const charge = vi.spyOn(f.adapter, 'chargeToken')
      if (outcome === 'unsent') {
        await pool.query("UPDATE payment_attempts SET created_at=now()-interval '1 hour 1 second' WHERE id=$1", [f.attempt])
      } else {
        await f.send()
        if (outcome !== 'inactive') {
          const sent = (await f.state()).sent_at as Date
          await reconcileTokenCharges(pool, f.adapter, new Date(sent.getTime() + 86_400_000))
        }
      }
      const reason = outcome === 'unsent' ? 'unsent_expired' : outcome === 'inactive' ? 'token_inactive' : 'abandoned'
      expect((await f.hosted()).status).toBe('redirected')
      expect(await f.state()).toMatchObject({ status: 'canceled', closed_reason: reason })
      expect(await f.send()).toBe(false)
      expect(charge).toHaveBeenCalledTimes(outcome === 'unavailable' || outcome === 'pending' ? 1 : 0)
    },
  )

  it('keeps the original settlement and records one credit work item on late duplicate success', async () => {
    const f = await fixture()
    const openedAt = new Date(Date.now() - 86_401_000)
    await pool.query('UPDATE payment_attempts SET created_at=$2 WHERE id=$1',[f.attempt,openedAt])
    await claimForSend(pool, f.attempt, () => openedAt.getTime())
    const hosted = await f.hosted()
    if (!hosted.provider_ref) throw new Error('fixture has no provider reference')
    await applyConfirmedEvent(pool, f.adapter.settle(hosted.provider_ref))
    const late = { ...f.adapter.settle(hosted.provider_ref), provider_ref: f.attempt, payment_id: f.attempt, attempt_id: f.attempt, event_id: randomUUID() }
    expect(await applyConfirmedEvent(pool, late)).toBe('accepted')
    expect(await applyConfirmedEvent(pool, { ...late, event_id: randomUUID() })).toBe('ignored')
    expect(await f.orderState()).toEqual({ payment_state: 'paid', paid_attempt_id: hosted.id })
    const outbox = (await pool.query("SELECT payload FROM commercial_outbox WHERE aggregate_id=$1 AND kind='reconcile.refund'", [f.order])).rows
    expect(outbox).toEqual([{ payload: expect.objectContaining({ attempt_id: f.attempt, duplicate: true }) }])
    await processRefundOutbox(pool)
    await processRefundOutbox(pool)
    const notes = (await pool.query('SELECT status,kind,amount_minor FROM invoice_adjustments WHERE invoice_id=$1', [f.invoice])).rows
    expect(notes).toEqual([{ status: 'pending', kind: 'credit_note', amount_minor: '1000' }])
  })

  it.each(['created', 'unknown', 'pending'] as const)('records a received bank transfer while %s blocks the hosted flow', async status => {
    const f = await fixture()
    if (status === 'unknown') await claimForSend(pool, f.attempt)
    if (status === 'pending') {
      f.adapter.scriptCharge(f.attempt, 'pending')
      await f.send()
    }
    const create = vi.spyOn(f.adapter, 'createAttempt')
    await expect(f.hosted()).rejects.toMatchObject({ code: 'payment_charge_in_progress' })
    await expect(bankTransferInstructions(pool, { invoice_id: f.invoice, customer_id: f.customer }))
      .rejects.toMatchObject({ code: 'payment_charge_in_progress' })
    expect(create).not.toHaveBeenCalled()
    const transfer = await confirmBankTransfer(pool, { invoice_id: f.invoice, operator: 'fixture', reference: `wire-${f.invoice}`,
      amount: 1000, value_date: riyadhDate(new Date()) })
    expect(await f.state()).toMatchObject({ status: 'canceled', closed_reason: 'superseded' })
    expect(await f.orderState()).toEqual({ payment_state: 'paid', paid_attempt_id: transfer.attempt.id })
  })

  it('settles an abandoned charge that succeeds before a hosted payment', async () => {
    const f = await fixture()
    await claimForSend(pool, f.attempt)
    const sent = (await f.state()).sent_at as Date
    await reconcileTokenCharges(pool, f.adapter, new Date(sent.getTime() + 86_400_000))
    expect(await f.state()).toMatchObject({ status: 'canceled', closed_reason: 'abandoned' })
    const late = await f.adapter.chargeToken({ attempt_id: f.attempt, token: 'fixture-token',
      amount: { minor: 1000, currency: 'SAR', exponent: 2 }, description: 'Late charge', callback_url: 'https://liwan.test/payment' })
    expect(await applyConfirmedEvent(pool, late)).toBe('accepted')
    expect(await f.orderState()).toEqual({ payment_state: 'paid', paid_attempt_id: f.attempt })
    await expect(f.hosted()).rejects.toMatchObject({ code: 'payment_not_awaiting' })
  })
})
