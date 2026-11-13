import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { Pool } from 'pg'
import { migrate } from '../db.js'
import { url } from './commercial-helpers.js'

const suite = url ? describe : describe.skip
const SRC = new URL('../', import.meta.url)
/** schema_040 and schema_041 do not exist: the numbering skips them. */
const BEFORE_058 = Array.from({ length: 57 }, (_, i) => i + 1).filter(v => v !== 40 && v !== 41)
const fileFor = (version: number) => (version === 1 ? 'schema.sql' : `schema_${String(version).padStart(3, '0')}.sql`)

/** schema_058 carries a database that ran schema_001..057: it has a token_charge flag and a subscription token to turn into the new shape. */
suite('schema_058 carries a database that ran schema_001..057', () => {
  const dbName = `liwan_control_scratch_pm${randomUUID().slice(0, 8).replace(/-/g, '')}`
  const withDb = (name: string) => { const u = new URL(url!); u.pathname = `/${name}`; return u.toString() }
  let pool: Pool
  let created = false
  const ids = { customer: randomUUID(), subscription: randomUUID(), order: randomUUID(), invoice: randomUUID(), direct: randomUUID(), hosted: randomUUID(), revision: randomUUID() }

  beforeAll(async () => {
    const admin = new Pool({ connectionString: withDb('postgres') })
    try { await admin.query(`CREATE DATABASE ${dbName}`); created = true } finally { await admin.end() }
    pool = new Pool({ connectionString: withDb(dbName), max: 4 })
    const client = await pool.connect()
    try {
      await client.query('CREATE TABLE IF NOT EXISTS schema_migrations(version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())')
      for (const version of BEFORE_058) {
        await client.query(await readFile(new URL(fileFor(version), SRC), 'utf8'))
        await client.query('INSERT INTO schema_migrations(version) VALUES($1)', [version])
      }
      // The old shape: one subscription holding a provider token, one hosted-invoice attempt and one token charge.
      await client.query('INSERT INTO customers(id,name) VALUES($1,$2)', [ids.customer, 'Migration customer'])
      await client.query('INSERT INTO subscriptions(id,customer_id,provider_token_ref,auto_renew_enabled,auto_renew_consent_at) VALUES($1,$2,$3,true,now())', [ids.subscription, ids.customer, 'tok_old_shape'])
      await client.query("INSERT INTO subscription_revisions(id,subscription_id,revision,snapshot,quote_id) VALUES($1,$2,1,'{}',$3)", [ids.revision, ids.subscription, randomUUID()])
      await client.query(`INSERT INTO orders(id,customer_id,subscription_id,kind,quote_id,target_revision_id,payment_state,fulfillment_state,idempotency_key,request_digest,due_now_minor,currency,exponent)
        VALUES($1,$2,$3,'new',$4,$5,'paid','applied',$6,'fixture',11500,'SAR',2)`, [ids.order, ids.customer, ids.subscription, randomUUID(), ids.revision, randomUUID()])
      await client.query(`INSERT INTO invoices(id,customer_id,subscription_id,order_id,kind,status,currency,exponent,subtotal_minor,tax_minor,total_minor,period_start,period_end,due_at)
        VALUES($1,$2,$3,$4,'initial','paid','SAR',2,10000,1500,11500,'2026-01-01','2026-02-01',now())`, [ids.invoice, ids.customer, ids.subscription, ids.order])
      await client.query(`INSERT INTO payment_attempts(id,order_id,invoice_id,provider,mode,provider_ref,amount_minor,currency,exponent,status,token_charge)
        VALUES($1,$3,$4,'moyasar','live','pay_direct',11500,'SAR',2,'failed',true),($2,$3,$4,'moyasar','live','inv_hosted',11500,'SAR',2,'succeeded',false)`, [ids.direct, ids.hosted, ids.order, ids.invoice])
    } finally { client.release() }
    await migrate(pool)
  })
  afterAll(async () => {
    await pool?.end()
    if (!created) return
    const admin = new Pool({ connectionString: withDb('postgres') })
    try { await admin.query(`DROP DATABASE ${dbName}`) } finally { await admin.end() }
  })
  const columns = async (table: string) => (await pool.query('SELECT column_name FROM information_schema.columns WHERE table_name=$1', [table])).rows.map(r => r.column_name as string)

  it('turns the token_charge flag into the attempt kind in both directions and drops the flag', async () => {
    const kinds = Object.fromEntries((await pool.query('SELECT id,kind FROM payment_attempts')).rows.map(r => [r.id, r.kind]))
    expect(kinds).toEqual({ [ids.direct]: 'saved_card', [ids.hosted]: 'hosted_invoice' })
    const attemptColumns = await columns('payment_attempts')
    expect(attemptColumns).not.toContain('token_charge')
    expect(attemptColumns).toContain('kind')
    // The form's bookkeeping columns (schema_061) are the ones the form code writes, and nothing more.
    for (const used of ['provider_intent_ref', 'save_card', 'consent_at', 'consent_text_version']) expect(attemptColumns).toContain(used)
    expect(attemptColumns).not.toContain('failure_code')
    await expect(pool.query("UPDATE payment_attempts SET kind='token' WHERE id=$1", [ids.hosted])).rejects.toMatchObject({ constraint: 'payment_attempts_kind_check' })
    await pool.query("UPDATE payment_attempts SET kind='form' WHERE id=$1", [ids.hosted])
    expect((await pool.query('SELECT kind FROM payment_attempts WHERE id=$1', [ids.hosted])).rows[0]).toEqual({ kind: 'form' })
  })

  it('schema_061 keeps a card from being saved without its consent record and an intent from sitting on a non-form attempt', async () => {
    await expect(pool.query("UPDATE payment_attempts SET save_card=true WHERE id=$1", [ids.direct])).rejects.toMatchObject({ constraint: 'payment_attempts_save_card_consent_check' })
    await expect(pool.query("UPDATE payment_attempts SET save_card=true,consent_at=now(),consent_text_version='' WHERE id=$1", [ids.direct])).rejects.toMatchObject({ constraint: 'payment_attempts_save_card_consent_check' })
    await expect(pool.query("UPDATE payment_attempts SET provider_intent_ref='intent_1' WHERE id=$1", [ids.direct])).rejects.toMatchObject({ constraint: 'payment_attempts_intent_form_check' })
    expect((await pool.query('SELECT save_card FROM payment_attempts WHERE id=$1', [ids.direct])).rows[0]).toEqual({ save_card: false })
    await pool.query("UPDATE payment_attempts SET kind='form',provider_intent_ref='intent_1',save_card=true,consent_at=now(),consent_text_version='v1' WHERE id=$1", [ids.direct])
    await expect(pool.query("UPDATE payment_attempts SET provider_intent_ref='intent_1' WHERE id=$1", [ids.hosted])).rejects.toBeTruthy()
    await pool.query("UPDATE payment_attempts SET kind='saved_card',provider_intent_ref=NULL,save_card=false,consent_at=NULL,consent_text_version=NULL WHERE id=$1", [ids.direct])
  })

  it('drops the subscription token and keeps the auto-renew consent check', async () => {
    expect(await columns('subscriptions')).not.toContain('provider_token_ref')
    await expect(pool.query('UPDATE subscriptions SET auto_renew_consent_at=NULL,revision=revision+1 WHERE id=$1', [ids.subscription])).rejects.toBeTruthy()
  })

  it('creates payment_methods with no column that could hold a card number, a security code or a holder name', async () => {
    const names = await columns('payment_methods')
    for (const forbidden of ['pan', 'card_number', 'number', 'cvc', 'cvv', 'holder', 'holder_name', 'name']) expect(names).not.toContain(forbidden)
    expect(names).toEqual(expect.arrayContaining(['id', 'customer_id', 'provider', 'mode', 'provider_token', 'brand', 'last_four', 'exp_month', 'exp_year', 'funding', 'status', 'is_default', 'consent_at', 'consent_text_version', 'source_attempt_id', 'created_by', 'created_at', 'removed_at', 'removed_by']))
  })

  const insert = (over: Record<string, unknown> = {}) => {
    const row = { id: randomUUID(), customer_id: ids.customer, provider: 'moyasar', mode: 'live', provider_token: `tok_${randomUUID()}`, brand: 'visa', last_four: '4242', exp_month: 12, exp_year: 2030,
      status: 'active', is_default: false, consent_at: new Date(), consent_text_version: 'v1', created_by: 'test', removed_at: null, removed_by: null, ...over }
    const keys = Object.keys(row)
    return pool.query(`INSERT INTO payment_methods(${keys.join(',')}) VALUES(${keys.map((_, i) => `$${i + 1}`).join(',')})`, Object.values(row))
  }

  it('constrains the display facts, the status and the removal record', async () => {
    await expect(insert({ last_four: '424' })).rejects.toMatchObject({ constraint: expect.stringContaining('last_four') })
    await expect(insert({ last_four: '42a2' })).rejects.toMatchObject({ constraint: expect.stringContaining('last_four') })
    await expect(insert({ exp_month: 13 })).rejects.toMatchObject({ constraint: expect.stringContaining('exp_month') })
    await expect(insert({ exp_month: 0 })).rejects.toMatchObject({ constraint: expect.stringContaining('exp_month') })
    await expect(insert({ status: 'paused' })).rejects.toMatchObject({ constraint: expect.stringContaining('status') })
    await expect(insert({ status: 'removed' })).rejects.toMatchObject({ constraint: 'payment_methods_removed_check' })
    await expect(insert({ consent_at: null })).rejects.toMatchObject({ code: '23502' })
    await insert({ status: 'removed', removed_at: new Date(), removed_by: 'customer' })
    await insert({ source_attempt_id: ids.hosted, funding: 'credit' })
  })

  it('allows one provider token once and one default active method per customer', async () => {
    await insert({ provider_token: 'tok_unique', is_default: true })
    await expect(insert({ provider_token: 'tok_unique' })).rejects.toMatchObject({ constraint: 'payment_methods_token_unique' })
    await insert({ provider_token: 'tok_unique', mode: 'test' })
    await expect(insert({ is_default: true })).rejects.toMatchObject({ constraint: 'payment_methods_one_default' })
    // A default that is no longer active does not block the next default, and a non-default active row never does.
    await insert({ is_default: true, status: 'inactive' })
    await insert({ is_default: false })
    await pool.query("UPDATE payment_methods SET status='inactive' WHERE customer_id=$1 AND is_default AND status='active'", [ids.customer])
    await insert({ is_default: true })
  })
})
