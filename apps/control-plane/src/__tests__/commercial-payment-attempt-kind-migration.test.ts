import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { Pool } from 'pg'
import { migrate } from '../db.js'
import { url } from './commercial-helpers.js'

const suite = url ? describe : describe.skip
const SRC = new URL('../', import.meta.url)
/** schema_040 and schema_041 do not exist: the numbering skips them. */
const BEFORE_059 = Array.from({ length: 58 }, (_, i) => i + 1).filter(v => v !== 40 && v !== 41)
const fileFor = (version: number) => (version === 1 ? 'schema.sql' : `schema_${String(version).padStart(3, '0')}.sql`)

/** schema_059 carries a database that ran schema_001..058, where a bank transfer was labelled a hosted invoice by the column default. */
suite('schema_059 carries a database that ran schema_001..058', () => {
  const dbName = `liwan_control_scratch_kind${randomUUID().slice(0, 8).replace(/-/g, '')}`
  const withDb = (name: string) => { const u = new URL(url!); u.pathname = `/${name}`; return u.toString() }
  let pool: Pool
  let created = false
  const ids = { customer: randomUUID(), subscription: randomUUID(), order: randomUUID(), invoice: randomUUID(), revision: randomUUID(), bank: randomUUID(), hosted: randomUUID(), form: randomUUID() }

  beforeAll(async () => {
    const admin = new Pool({ connectionString: withDb('postgres') })
    try { await admin.query(`CREATE DATABASE ${dbName}`); created = true } finally { await admin.end() }
    pool = new Pool({ connectionString: withDb(dbName), max: 4 })
    const client = await pool.connect()
    try {
      await client.query('CREATE TABLE IF NOT EXISTS schema_migrations(version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())')
      for (const version of BEFORE_059) {
        await client.query(await readFile(new URL(fileFor(version), SRC), 'utf8'))
        await client.query('INSERT INTO schema_migrations(version) VALUES($1)', [version])
      }
      await client.query('INSERT INTO customers(id,name) VALUES($1,$2)', [ids.customer, 'Kind customer'])
      await client.query('INSERT INTO subscriptions(id,customer_id) VALUES($1,$2)', [ids.subscription, ids.customer])
      await client.query("INSERT INTO subscription_revisions(id,subscription_id,revision,snapshot,quote_id) VALUES($1,$2,1,'{}',$3)", [ids.revision, ids.subscription, randomUUID()])
      await client.query(`INSERT INTO orders(id,customer_id,subscription_id,kind,quote_id,target_revision_id,payment_state,fulfillment_state,idempotency_key,request_digest,due_now_minor,currency,exponent)
        VALUES($1,$2,$3,'new',$4,$5,'paid','applied',$6,'fixture',11500,'SAR',2)`, [ids.order, ids.customer, ids.subscription, randomUUID(), ids.revision, randomUUID()])
      await client.query(`INSERT INTO invoices(id,customer_id,subscription_id,order_id,kind,status,currency,exponent,subtotal_minor,tax_minor,total_minor,period_start,period_end,due_at)
        VALUES($1,$2,$3,$4,'initial','paid','SAR',2,10000,1500,11500,'2026-01-01','2026-02-01',now())`, [ids.invoice, ids.customer, ids.subscription, ids.order])
      // The old shape: no kind in the insert, so every row carries the default.
      await client.query(`INSERT INTO payment_attempts(id,order_id,invoice_id,provider,mode,provider_ref,amount_minor,currency,exponent,status)
        VALUES($1,$3,$4,'bank_transfer','live','TRF-1',11500,'SAR',2,'succeeded'),($2,$3,$4,'moyasar','live','inv_hosted',11500,'SAR',2,'failed')`, [ids.bank, ids.hosted, ids.order, ids.invoice])
      await client.query(`INSERT INTO payment_attempts(id,order_id,invoice_id,provider,mode,provider_ref,amount_minor,currency,exponent,status,kind)
        VALUES($1,$2,$3,'moyasar','live','pay_form',11500,'SAR',2,'failed','form')`, [ids.form, ids.order, ids.invoice])
    } finally { client.release() }
    await migrate(pool)
  })
  afterAll(async () => {
    await pool?.end()
    if (!created) return
    const admin = new Pool({ connectionString: withDb('postgres') })
    try { await admin.query(`DROP DATABASE ${dbName}`) } finally { await admin.end() }
  })

  it('relabels the bank transfer row and leaves the others as they were', async () => {
    const kinds = Object.fromEntries((await pool.query('SELECT id,kind FROM payment_attempts')).rows.map(r => [r.id, r.kind]))
    expect(kinds).toEqual({ [ids.bank]: 'bank_transfer', [ids.hosted]: 'hosted_invoice', [ids.form]: 'form' })
  })

  it('drops the default, so an insert without a kind is refused', async () => {
    const column = (await pool.query("SELECT column_default,is_nullable FROM information_schema.columns WHERE table_name='payment_attempts' AND column_name='kind'")).rows[0]
    expect(column).toEqual({ column_default: null, is_nullable: 'NO' })
    await expect(pool.query(`INSERT INTO payment_attempts(id,order_id,invoice_id,provider,mode,provider_ref,amount_minor,currency,exponent,status)
      VALUES($1,$2,$3,'moyasar','live','pay_x',100,'SAR',2,'failed')`, [randomUUID(), ids.order, ids.invoice])).rejects.toMatchObject({ code: '23502' })
  })

  it('allows the bank_transfer kind for a bank transfer only', async () => {
    const insert = (provider: string, kind: string) => pool.query(`INSERT INTO payment_attempts(id,order_id,invoice_id,provider,mode,provider_ref,amount_minor,currency,exponent,status,kind)
      VALUES($1,$2,$3,$4,'live',$5,100,'SAR',2,'failed',$6)`, [randomUUID(), ids.order, ids.invoice, provider, `ref-${randomUUID()}`, kind])
    await insert('bank_transfer', 'bank_transfer')
    await expect(insert('bank_transfer', 'hosted_invoice')).rejects.toMatchObject({ constraint: 'payment_attempts_bank_transfer_kind_check' })
    await expect(insert('moyasar', 'bank_transfer')).rejects.toMatchObject({ constraint: 'payment_attempts_bank_transfer_kind_check' })
    await expect(insert('moyasar', 'token')).rejects.toMatchObject({ constraint: 'payment_attempts_kind_check' })
  })
})
