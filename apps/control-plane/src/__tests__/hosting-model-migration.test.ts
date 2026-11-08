import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { Pool } from 'pg'
import { migrate } from '../db.js'
import { url } from './commercial-helpers.js'

const suite = url ? describe : describe.skip

suite('schema_034 splits hosting_model managed into shared_managed and dedicated_managed', () => {
  const dbName = `liwan_control_scratch_hosting${randomUUID().slice(0, 8).replace(/-/g, '')}`
  const withDb = (name: string) => { const u = new URL(url!); u.pathname = `/${name}`; return u.toString() }
  let pool: Pool
  let created = false

  beforeAll(async () => {
    const admin = new Pool({ connectionString: withDb('postgres') })
    try { await admin.query(`CREATE DATABASE ${dbName}`); created = true } finally { await admin.end() }
    pool = new Pool({ connectionString: withDb(dbName), max: 4 })
    await migrate(pool)
  })
  afterAll(async () => {
    await pool?.end()
    if (!created) return
    const admin = new Pool({ connectionString: withDb('postgres') })
    try { await admin.query(`DROP DATABASE ${dbName}`) } finally { await admin.end() }
  })

  const insert = (id: string, model: string) => pool.query(
    "INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,$2,'saas',$3,$4,false)", [id, `T ${id.slice(0, 6)}`, model, `inv-${id}`])

  it('rejects the retired managed value and accepts the three current ones', async () => {
    await expect(insert(randomUUID(), 'managed')).rejects.toThrow(/tenants_hosting_model_check/)
    for (const model of ['shared_managed', 'dedicated_managed', 'customer_hosted']) await expect(insert(randomUUID(), model)).resolves.toBeDefined()
  })

  it('back-fills managed rows: a shared-lane row means shared, everything else dedicated', async () => {
    // Rebuild the pre-034 state: the old two-value CHECK and `managed` rows.
    await pool.query('ALTER TABLE tenants DROP CONSTRAINT tenants_hosting_model_check')
    await pool.query("UPDATE tenants SET hosting_model='managed' WHERE hosting_model IN ('shared_managed','dedicated_managed')")
    await pool.query("ALTER TABLE tenants ADD CONSTRAINT tenants_hosting_model_check CHECK (hosting_model IN ('managed','customer_hosted'))")
    const [bound, onboarded, dedicated, hosted] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()]
    await insert(bound, 'managed'); await insert(onboarded, 'managed'); await insert(dedicated, 'managed'); await insert(hosted, 'customer_hosted')
    const slug = `t${bound.replaceAll('-', '')}`
    await pool.query('INSERT INTO shared_registry_bindings(control_tenant_id,tenant_id,host,database_name,filestore,enabled,registry_revision) VALUES($1,$2,$3,$4,$4,false,1)', [bound, slug, `${slug}.h.test`, `liwan_scratch_${slug}`])
    const onboardSlug = `t${onboarded.replaceAll('-', '')}`
    await pool.query("INSERT INTO shared_onboardings(request_id,control_tenant_id,issuer,actor_uid,request_digest,admin_name,admin_login,host,tenant_slug,database_name) VALUES($1,$1,'issuer',1,$2,'A','a@b.test',$3,$4,$5)", [onboarded, 'a'.repeat(64), `${onboardSlug}.h.test`, onboardSlug, `liwan_scratch_${onboardSlug}`])

    await pool.query(await readFile(new URL('../schema_034.sql', import.meta.url), 'utf8'))

    const rows = (await pool.query('SELECT id,hosting_model FROM tenants WHERE id = ANY($1)', [[bound, onboarded, dedicated, hosted]])).rows
    const model = (id: string) => rows.find(r => r.id === id)?.hosting_model
    expect(model(bound)).toBe('shared_managed')
    expect(model(onboarded)).toBe('shared_managed')
    expect(model(dedicated)).toBe('dedicated_managed')
    expect(model(hosted)).toBe('customer_hosted')
    expect((await pool.query("SELECT count(*)::int n FROM tenants WHERE hosting_model='managed'")).rows[0].n).toBe(0)
    await expect(insert(randomUUID(), 'managed')).rejects.toThrow(/tenants_hosting_model_check/)
  })
})
