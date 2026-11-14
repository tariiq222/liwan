import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { Pool } from 'pg'
import { migrate } from '../db.js'
import { url } from './commercial-helpers.js'

const suite = url ? describe : describe.skip
const SRC = new URL('../', import.meta.url)
/** schema_040 and schema_041 do not exist: the numbering skips them. */
const UP_TO_061 = Array.from({ length: 61 }, (_, i) => i + 1).filter(v => v !== 40 && v !== 41)
const fileFor = (version: number) => (version === 1 ? 'schema.sql' : `schema_${String(version).padStart(3, '0')}.sql`)

/** A database that ran schema_001..061 holds cards, form attempts and a declined order; schema_062, schema_063 and schema_064 must carry every one of them. */
suite('schema_062, schema_063 and schema_064 carry rows created under schema_058..061', () => {
  const dbName = `liwan_control_scratch_os${randomUUID().slice(0, 8).replace(/-/g, '')}`
  const withDb = (name: string) => { const u = new URL(url!); u.pathname = `/${name}`; return u.toString() }
  let pool: Pool
  let created = false
  const ids = { customer: randomUUID(), subscription: randomUUID(), revision: randomUUID(), declined: randomUUID(), paid: randomUUID(), invoice: randomUUID(), form: randomUUID(),
    activeCard: randomUUID(), removedCard: randomUUID() }

  const order = (client: { query: (sql: string, values: unknown[]) => Promise<unknown> }, id: string, state: string) => client.query(
    `INSERT INTO orders(id,customer_id,subscription_id,kind,quote_id,target_revision_id,payment_state,fulfillment_state,idempotency_key,request_digest,due_now_minor,currency,exponent)
     VALUES($1,$2,$3,'new',$4,$5,$6,'not_started',$7,'fixture',11500,'SAR',2)`, [id, ids.customer, ids.subscription, randomUUID(), ids.revision, state, randomUUID()])
  const card = (client: { query: (sql: string, values: unknown[]) => Promise<unknown> }, id: string, token: string, status: string, isDefault: boolean) => client.query(
    `INSERT INTO payment_methods(id,customer_id,provider,mode,provider_token,brand,last_four,exp_month,exp_year,status,is_default,consent_at,consent_text_version,created_by,removed_at,removed_by)
     VALUES($1,$2,'moyasar','live',$3,'visa','4242',12,2030,$4,$5,now(),'v1','test',CASE WHEN $4='removed' THEN now() END,CASE WHEN $4='removed' THEN 'system' END)`, [id, ids.customer, token, status, isDefault])

  beforeAll(async () => {
    const admin = new Pool({ connectionString: withDb('postgres') })
    try { await admin.query(`CREATE DATABASE ${dbName}`); created = true } finally { await admin.end() }
    pool = new Pool({ connectionString: withDb(dbName), max: 4 })
    const client = await pool.connect()
    try {
      await client.query('CREATE TABLE IF NOT EXISTS schema_migrations(version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())')
      for (const version of UP_TO_061) {
        await client.query(await readFile(new URL(fileFor(version), SRC), 'utf8'))
        await client.query('INSERT INTO schema_migrations(version) VALUES($1)', [version])
      }
      await client.query('INSERT INTO customers(id,name) VALUES($1,$2)', [ids.customer, 'Migration customer'])
      await client.query('INSERT INTO subscriptions(id,customer_id,auto_renew_enabled,auto_renew_consent_at) VALUES($1,$2,true,now())', [ids.subscription, ids.customer])
      await client.query("INSERT INTO subscription_revisions(id,subscription_id,revision,snapshot,quote_id) VALUES($1,$2,1,'{}',$3)", [ids.revision, ids.subscription, randomUUID()])
      await order(client, ids.declined, 'failed')
      await order(client, ids.paid, 'paid')
      await client.query(`INSERT INTO invoices(id,customer_id,subscription_id,order_id,kind,status,currency,exponent,subtotal_minor,tax_minor,total_minor,period_start,period_end,due_at)
        VALUES($1,$2,$3,$4,'initial','paid','SAR',2,10000,1500,11500,'2026-01-01','2026-02-01',now())`, [ids.invoice, ids.customer, ids.subscription, ids.paid])
      await client.query(`INSERT INTO payment_attempts(id,order_id,invoice_id,provider,mode,amount_minor,currency,exponent,status,kind,provider_intent_ref,save_card,consent_at,consent_text_version)
        VALUES($1,$2,$3,'moyasar','live',11500,'SAR',2,'pending','form','intent_061',true,now(),'v1')`, [ids.form, ids.paid, ids.invoice])
      await card(client, ids.activeCard, 'tok_active_061', 'active', true)
      await card(client, ids.removedCard, 'tok_removed_061', 'removed', false)
    } finally { client.release() }
    await migrate(pool)
  })
  afterAll(async () => {
    await pool?.end()
    if (!created) return
    const admin = new Pool({ connectionString: withDb('postgres') })
    try { await admin.query(`DROP DATABASE ${dbName}`) } finally { await admin.end() }
  })

  it('records both migrations and keeps every existing row', async () => {
    expect((await pool.query('SELECT version FROM schema_migrations WHERE version IN (62,63,64) ORDER BY version')).rows.map(r => r.version)).toEqual([62, 63, 64])
    expect((await pool.query('SELECT id,status,provider_token FROM payment_methods ORDER BY created_at,id')).rows.sort((a, b) => a.status.localeCompare(b.status)))
      .toEqual([{ id: ids.activeCard, status: 'active', provider_token: 'tok_active_061' }, { id: ids.removedCard, status: 'removed', provider_token: 'tok_removed_061' }].sort((a, b) => a.status.localeCompare(b.status)))
    expect((await pool.query('SELECT status,provider_intent_ref,callback_secret,declined_payment_ref,save_card FROM payment_attempts WHERE id=$1', [ids.form])).rows[0])
      .toEqual({ status: 'pending', provider_intent_ref: 'intent_061', callback_secret: null, declined_payment_ref: null, save_card: true })
  })

  it('schema_064 gives the form attempt of an earlier database an actor of \'unknown\' and requires one wherever a card is to be kept', async () => {
    expect((await pool.query('SELECT opened_by,save_card FROM payment_attempts WHERE id=$1', [ids.form])).rows[0]).toEqual({ opened_by: 'unknown', save_card: true })
    await expect(pool.query('UPDATE payment_attempts SET opened_by=NULL WHERE id=$1', [ids.form])).rejects.toMatchObject({ constraint: 'payment_attempts_consent_actor_check' })
    await expect(pool.query("UPDATE payment_attempts SET opened_by='' WHERE id=$1", [ids.form])).rejects.toMatchObject({ constraint: 'payment_attempts_opened_by_check' })
  })

  it('schema_062 lets the removed row of an earlier database forget its token and still requires one of every other row', async () => {
    await pool.query('UPDATE payment_methods SET provider_token=NULL WHERE id=$1', [ids.removedCard])
    await expect(pool.query('UPDATE payment_methods SET provider_token=NULL WHERE id=$1', [ids.activeCard])).rejects.toMatchObject({ constraint: 'payment_methods_token_present_check' })
    await pool.query("UPDATE payment_attempts SET callback_secret=repeat('b',32) WHERE id=$1", [ids.form])
  })

  it('schema_063 puts a declined order back to awaiting payment and leaves no failed payment state', async () => {
    expect((await pool.query('SELECT id,payment_state FROM orders ORDER BY payment_state')).rows).toEqual([{ id: ids.declined, payment_state: 'awaiting_payment' }, { id: ids.paid, payment_state: 'paid' }])
    await expect(pool.query("UPDATE orders SET payment_state='failed' WHERE id=$1", [ids.declined])).rejects.toMatchObject({ constraint: 'orders_payment_state_check' })
    await pool.query("UPDATE orders SET payment_state='paid' WHERE id=$1", [ids.declined])
  })

  it('schema_063 keeps the guard that a paid order never goes back to awaiting payment, and the immutable identity', async () => {
    await expect(pool.query("UPDATE orders SET payment_state='awaiting_payment' WHERE id=$1", [ids.paid])).rejects.toThrow('order_payment_regression')
    await expect(pool.query("UPDATE orders SET due_now_minor=1 WHERE id=$1", [ids.paid])).rejects.toThrow('order_identity_immutable')
  })
})
