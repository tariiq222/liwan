import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { ATTENTION_LIMIT, attentionKinds, attentionSchema } from '@liwan/commercial-contracts'
import { allAttentionItems, attention } from '../commercial/attention.js'
import { migrate } from '../db.js'
import { beat, recordAvailability } from '../service-health.js'
import { url } from './commercial-helpers.js'

const suite = url ? describe : describe.skip
suite('service_down in the vendor attention list', () => {
  const dbName = `liwan_control_scratch_healthattn${randomUUID().slice(0, 8).replace(/-/g, '')}`
  const withDb = (name: string) => { const u = new URL(url!); u.pathname = `/${name}`; return u.toString() }
  let pool: Pool
  let created = false
  const ago = (ms: number) => new Date(Date.now() - ms)
  const MINUTE = 60_000
  const down = async (includeBilling = true) => (await attention(pool, includeBilling)).items.filter(i => i.kind === 'service_down')

  beforeAll(async () => {
    const admin = new Pool({ connectionString: withDb('postgres') })
    try { await admin.query(`CREATE DATABASE ${dbName}`); created = true } finally { await admin.end() }
    pool = new Pool({ connectionString: withDb(dbName) })
    await migrate(pool)
  })
  afterAll(async () => {
    await pool?.end()
    if (!created) return
    const admin = new Pool({ connectionString: withDb('postgres') })
    try { await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`) } finally { await admin.end() }
  })
  beforeEach(async () => { await pool.query('DELETE FROM service_heartbeats'); await pool.query('TRUNCATE customers CASCADE') })

  it('is a kind of the contract', () => { expect(attentionKinds).toContain('service_down') })

  it('lists nothing for a component never seen or one that is ok', async () => {
    expect(await down()).toEqual([])
    await beat(pool, 'shared_worker', { startedAt: ago(MINUTE) })
    await beat(pool, 'commercial_scheduler', { startedAt: ago(MINUTE) })
    await recordAvailability(pool, 'payment_adapter', { startedAt: ago(MINUTE) })
    expect(await down()).toEqual([])
  })

  it('lists a stale worker once, named by the component and dated by its last beat, and drops it when it beats again', async () => {
    await beat(pool, 'shared_worker', { startedAt: ago(60 * MINUTE), now: ago(10 * MINUTE) })
    const [item, ...rest] = await down()
    expect(rest).toEqual([])
    expect(item).toMatchObject({ kind: 'service_down', name: 'shared_worker', customer_id: null, tenant_id: null, operation_id: null, invoice_id: null, detail: 'stale' })
    expect(Math.abs(Date.parse(item!.since) - (Date.now() - 10 * MINUTE))).toBeLessThan(2000)
    await beat(pool, 'shared_worker', { startedAt: ago(60 * MINUTE) })
    expect(await down()).toEqual([])
  })

  it('lists an unavailable adapter with no reason, and not the adapters of a stale worker', async () => {
    await beat(pool, 'shared_worker', { startedAt: ago(MINUTE) })
    await recordAvailability(pool, 'mail_adapter', { startedAt: ago(MINUTE), error: Object.assign(new Error('smtp://u:secret@mail.internal'), { code: 'mail_not_configured' }) })
    await recordAvailability(pool, 'api_payment_adapter', { startedAt: ago(MINUTE), error: new Error('x') })
    const items = await down()
    expect(items.map(i => [i.name, i.detail])).toEqual([['mail_adapter', 'unavailable'], ['api_payment_adapter', 'unavailable']])
    expect(JSON.stringify(items)).not.toContain('mail_not_configured')
    await beat(pool, 'shared_worker', { startedAt: ago(10 * MINUTE), now: ago(5 * MINUTE) })
    expect((await down()).map(i => i.name)).toEqual(['shared_worker', 'api_payment_adapter'])
  })

  it('comes first in the list and in the total, for a vendor with or without billing access', async () => {
    await pool.query("INSERT INTO customers(id,name,commercial_setup_required) VALUES($1,'Needs setup',true)", [randomUUID()])
    await beat(pool, 'shared_worker', { startedAt: ago(60 * MINUTE), now: ago(10 * MINUTE) })
    for (const billing of [true, false]) {
      const list = attentionSchema.parse(await attention(pool, billing))
      expect(list.items.map(i => i.kind)).toEqual(['service_down', 'setup_required'])
      expect(list.total).toBe(2)
    }
  })

  it('does not belong to one customer, so a customer-scoped list has none', async () => {
    const customer = randomUUID()
    await pool.query("INSERT INTO customers(id,name,commercial_setup_required) VALUES($1,'Needs setup',true)", [customer])
    await beat(pool, 'shared_worker', { startedAt: ago(60 * MINUTE), now: ago(10 * MINUTE) })
    const scoped = await attention(pool, true, customer)
    expect(scoped.items.map(i => i.kind)).toEqual(['setup_required'])
    expect(scoped.total).toBe(1)
  })

  it('keeps the list within its cap and counts every item in the total', async () => {
    for (let i = 0; i < ATTENTION_LIMIT; i++) await pool.query("INSERT INTO customers(id,name,commercial_setup_required) VALUES($1,$2,true)", [randomUUID(), `Needs setup ${i}`])
    await beat(pool, 'shared_worker', { startedAt: ago(60 * MINUTE), now: ago(10 * MINUTE) })
    const list = await attention(pool, true)
    expect(list.items).toHaveLength(ATTENTION_LIMIT)
    expect(list.items[0]!.kind).toBe('service_down')
    expect(list.total).toBe(ATTENTION_LIMIT + 1)
    expect((await allAttentionItems(pool)).map(i => i.kind)[0]).toBe('service_down')
    expect(await allAttentionItems(pool)).toHaveLength(ATTENTION_LIMIT + 1)
  })

  it('still answers when the health table cannot be read', async () => {
    await pool.query("INSERT INTO customers(id,name,commercial_setup_required) VALUES($1,'Needs setup',true)", [randomUUID()])
    await pool.query('ALTER TABLE service_heartbeats RENAME TO service_heartbeats_away')
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect((await attention(pool, true)).items.map(i => i.kind)).toEqual(['setup_required'])
      expect((await allAttentionItems(pool)).map(i => i.kind)).toEqual(['setup_required'])
    } finally { spy.mockRestore(); await pool.query('ALTER TABLE service_heartbeats_away RENAME TO service_heartbeats') }
  })
})
