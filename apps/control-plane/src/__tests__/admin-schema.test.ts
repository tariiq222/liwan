import { randomUUID } from 'node:crypto'
import { describe, expect, it, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { Pool } from 'pg'
import { migrate } from '../db.js'

const url = process.env.CONTROL_TEST_DATABASE_URL

/** Nothing the old version 11 created for the retired Track A packages: tables, index, column, triggers and functions. */
async function expectNoTrackAObjects(pool: Pool) {
  const objects = await pool.query(`SELECT to_regclass('commercial_packages') AS package_table, to_regclass('package_revisions') AS revision_table,
    to_regclass('tenants_package_revision_idx') AS index,
    (SELECT count(*)::int FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='tenants' AND column_name='package_revision_id') AS column,
    (SELECT count(*)::int FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('tenant_package_guard','package_revision_guard')) AS triggers,
    (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=current_schema() AND p.proname IN ('protect_tenant_package','protect_package_revision')) AS functions`)
  expect(objects.rows[0]).toEqual({ package_table: null, revision_table: null, index: null, column: 0, triggers: 0, functions: 0 })
}

/** Nothing the old version 8 created for the retired Package-6 sandbox orders: tables, index, trigger and function. */
async function expectNoPackage6OrderObjects(pool: Pool) {
  const objects = await pool.query(`SELECT to_regclass('shared_orders') AS orders_table, to_regclass('shared_payment_events') AS payment_events_table,
    to_regclass('shared_orders_idempotency') AS index,
    (SELECT count(*)::int FROM pg_trigger WHERE NOT tgisinternal AND tgname='shared_order_identity') AS triggers,
    (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=current_schema() AND p.proname='shared_order_quote_immutable') AS functions`)
  expect(objects.rows[0]).toEqual({ orders_table: null, payment_events_table: null, index: null, triggers: 0, functions: 0 })
}

if (!url) describe.skip('admin schema (requires CONTROL_TEST_DATABASE_URL)', () => {})
else describe('admin schema', () => {
  const pool = new Pool({ connectionString: url })
  beforeAll(async () => { await migrate(pool); await migrate(pool) })
  afterAll(async () => { await pool.end() })
  it('creates every identity table once', async () => {
    const rows = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'vendor_%' ORDER BY 1")
    expect(rows.rows.map((r) => r.table_name)).toEqual(['vendor_account_roles','vendor_accounts','vendor_auth_attempts','vendor_auth_challenges','vendor_invitations','vendor_passkeys','vendor_recovery_codes','vendor_sessions','vendor_totp'])
  })
  it('keeps no remnant of the legacy commercial migration', async () => {
    const tables = await pool.query("SELECT to_regclass('legacy_mappings') AS a, to_regclass('migration_runs') AS b")
    expect(tables.rows[0]).toEqual({ a: null, b: null })
    const column = await pool.query("SELECT 1 FROM information_schema.columns WHERE table_name='subscriptions' AND column_name='legacy_source'")
    expect(column.rowCount).toBe(0)
  })
  it('keeps no remnant of the retired Track A packages', async () => {
    await expectNoTrackAObjects(pool)
  })
  it('keeps no remnant of the retired Package-6 sandbox orders', async () => {
    await expectNoPackage6OrderObjects(pool)
  })
  it('stores emails case-insensitively unique', async () => {
    await pool.query("TRUNCATE vendor_accounts CASCADE")
    await pool.query("INSERT INTO vendor_accounts(email,display_name) VALUES('a@liwanos.com','A')")
    await expect(pool.query("INSERT INTO vendor_accounts(email,display_name) VALUES('A@liwanos.com','B')")).rejects.toThrow()
  })
  it('rejects unknown role keys', async () => {
    const a = await pool.query("INSERT INTO vendor_accounts(email,display_name) VALUES('r@liwanos.com','R') RETURNING id")
    await expect(pool.query("INSERT INTO vendor_account_roles(account_id,role) VALUES($1,'god')", [a.rows[0].id])).rejects.toThrow()
  })
})

/**
 * schema_082 removes the retired Track A packages (owner decision 2026-11-27) from a database that applied the old
 * version 11. That version no longer creates them, so each case rebuilds the old state from stand-ins on its own
 * fresh scratch database and runs the real `migrate()` there: the suite's shared database is never altered.
 */
if (!url) describe.skip('schema_082 removes the retired Track A packages (requires CONTROL_TEST_DATABASE_URL)', () => {})
else describe('schema_082 removes the retired Track A packages', () => {
  let database = ''
  let pool: Pool | undefined
  const activePool = () => {
    if (!pool) throw new Error('scratch database pool was not initialized')
    return pool
  }
  const adminUrl = (() => { const u = new URL(url); u.pathname = '/postgres'; return u.toString() })()

  beforeEach(async () => {
    database = `liwan_control_scratch_tracka${randomUUID().slice(0, 8).replace(/-/g, '')}`
    const admin = new Pool({ connectionString: adminUrl })
    try { await admin.query(`CREATE DATABASE ${database}`) } finally { await admin.end() }
    const databaseUrl = new URL(url)
    databaseUrl.pathname = `/${database}`
    pool = new Pool({ connectionString: databaseUrl.toString(), max: 4 })
  })
  afterEach(async () => {
    const current = pool
    pool = undefined
    const db = database
    database = ''
    try {
      if (current) await current.end()
    } finally {
      if (db) {
        const admin = new Pool({ connectionString: adminUrl })
        try { await admin.query(`DROP DATABASE IF EXISTS ${db}`) } finally { await admin.end() }
      }
    }
  })

  const applied = async () => (await activePool().query('SELECT count(*)::int AS n FROM schema_migrations WHERE version=82')).rows[0].n as number

  it('leaves a fresh database with no Track A object and records version 82 once', async () => {
    const p = activePool()
    await migrate(p)
    await expectNoTrackAObjects(p)
    expect(await applied()).toBe(1)
    await migrate(p)
    expect(await applied()).toBe(1)
  })

  it('refuses while tenants still reference a package revision, and succeeds once they no longer do', async () => {
    const p = activePool()
    await migrate(p)
    await p.query('ALTER TABLE tenants ADD COLUMN package_revision_id uuid')
    const pinned = [randomUUID(), randomUUID()]
    for (const id of pinned) await p.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled,package_revision_id) VALUES($1,'Pinned tenant','saas','shared_managed',$2,false,$3)", [id, `pinned-${id}`, randomUUID()])
    await p.query('DELETE FROM schema_migrations WHERE version=82')
    await expect(migrate(p)).rejects.toThrow(/2 tenant\(s\) still reference a retired Track A package revision.*migrate again/)
    // The refusal rolls back the whole run: the stand-in is intact and nothing is recorded.
    expect(await applied()).toBe(0)
    expect((await p.query('SELECT count(*)::int AS n FROM tenants WHERE package_revision_id IS NOT NULL')).rows[0].n).toBe(2)
    await p.query('UPDATE tenants SET package_revision_id=NULL')
    await migrate(p)
    expect(await applied()).toBe(1)
    await expectNoTrackAObjects(p)
    expect((await p.query('SELECT count(*)::int AS n FROM tenants WHERE id=ANY($1)', [pinned])).rows[0].n).toBe(2)
  })

  it('refuses while a job payload still carries packageAuthority, and succeeds once the key is gone', async () => {
    const p = activePool()
    await migrate(p)
    const tenant = randomUUID(), slug = `t${tenant.replaceAll('-', '')}`, job = randomUUID()
    await p.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,'Pinned job tenant','saas','shared_managed',$2,false)", [tenant, `job-${tenant}`])
    await p.query('INSERT INTO shared_registry_bindings(control_tenant_id,tenant_id,host,database_name,filestore,enabled,registry_revision) VALUES($1,$2,$3,$4,$4,false,1)', [tenant, slug, `${slug}.tracka.test`, `liwan_scratch_${slug}`])
    await p.query("INSERT INTO shared_jobs(id,control_tenant_id,business_key,payload,payload_digest,issuer,actor_uid,reason) VALUES($1,$2,'tracka:guard',$3,$4,'tracka-test',1,'Guard probe')", [job, tenant, { operation: 'provision', packageAuthority: { schemaVersion: 2 } }, 'a'.repeat(64)])
    await p.query('DELETE FROM schema_migrations WHERE version=82')
    await expect(migrate(p)).rejects.toThrow(/1 shared_jobs row\(s\) still carry packageAuthority in payload.*migrate again/)
    expect(await applied()).toBe(0)
    expect((await p.query("SELECT payload ? 'packageAuthority' AS carries FROM shared_jobs WHERE id=$1", [job])).rows[0].carries).toBe(true)
    // Probe-row cleanup in this test only; shared_jobs rows are immutable and digest-bound in production.
    await p.query('ALTER TABLE shared_jobs DISABLE TRIGGER shared_job_identity')
    await p.query("UPDATE shared_jobs SET payload=payload-'packageAuthority' WHERE id=$1", [job])
    await p.query('ALTER TABLE shared_jobs ENABLE TRIGGER shared_job_identity')
    await migrate(p)
    expect(await applied()).toBe(1)
    await expectNoTrackAObjects(p)
  })

  it('drops every object of a database that applied the old version 11, without CASCADE', async () => {
    const p = activePool()
    await migrate(p)
    // The dependency edges of the old version 11: the column's foreign key and index, each trigger's function, the child table.
    await p.query(`
      CREATE TABLE commercial_packages (id uuid PRIMARY KEY);
      CREATE TABLE package_revisions (id uuid PRIMARY KEY, package_id uuid NOT NULL REFERENCES commercial_packages(id));
      ALTER TABLE tenants ADD COLUMN package_revision_id uuid REFERENCES package_revisions(id);
      CREATE INDEX tenants_package_revision_idx ON tenants(package_revision_id);
      CREATE FUNCTION protect_package_revision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
      CREATE TRIGGER package_revision_guard BEFORE UPDATE OR DELETE ON package_revisions FOR EACH ROW EXECUTE FUNCTION protect_package_revision();
      CREATE FUNCTION protect_tenant_package() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
      CREATE TRIGGER tenant_package_guard BEFORE INSERT OR UPDATE ON tenants FOR EACH ROW EXECUTE FUNCTION protect_tenant_package();
    `)
    await p.query('INSERT INTO commercial_packages(id) VALUES($1)', [randomUUID()])
    await p.query('INSERT INTO package_revisions(id,package_id) VALUES($1,(SELECT id FROM commercial_packages))', [randomUUID()])
    // No tenant used a package: the column held nothing but NULLs.
    const tenant = randomUUID()
    await p.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,'Legacy tenant','saas','shared_managed',$2,false)", [tenant, `legacy-${tenant}`])
    await p.query('DELETE FROM schema_migrations WHERE version=82')
    await migrate(p)
    expect(await applied()).toBe(1)
    await expectNoTrackAObjects(p)
    expect((await p.query('SELECT count(*)::int AS n FROM tenants WHERE id=$1', [tenant])).rows[0].n).toBe(1)
  })
})

/**
 * schema_083 removes the retired Package-6 sandbox orders from a database that applied the old version 8.
 * That version no longer creates them, so each case rebuilds the old object graph on its own fresh scratch
 * database and runs the real `migrate()` there: the suite's shared database is never altered.
 */
if (!url) describe.skip('schema_083 removes the retired Package-6 sandbox orders (requires CONTROL_TEST_DATABASE_URL)', () => {})
else describe('schema_083 removes the retired Package-6 sandbox orders', () => {
  let database = ''
  let pool: Pool | undefined
  const activePool = () => {
    if (!pool) throw new Error('scratch database pool was not initialized')
    return pool
  }
  const adminUrl = (() => { const u = new URL(url); u.pathname = '/postgres'; return u.toString() })()

  beforeEach(async () => {
    database = `liwan_control_scratch_pkg6${randomUUID().slice(0, 8).replace(/-/g, '')}`
    const admin = new Pool({ connectionString: adminUrl })
    try { await admin.query(`CREATE DATABASE ${database}`) } finally { await admin.end() }
    const databaseUrl = new URL(url)
    databaseUrl.pathname = `/${database}`
    pool = new Pool({ connectionString: databaseUrl.toString(), max: 4 })
  })
  afterEach(async () => {
    const current = pool
    pool = undefined
    const db = database
    database = ''
    try {
      if (current) await current.end()
    } finally {
      if (db) {
        const admin = new Pool({ connectionString: adminUrl })
        try { await admin.query(`DROP DATABASE IF EXISTS ${db}`) } finally { await admin.end() }
      }
    }
  })

  const applied = async () => (await activePool().query('SELECT count(*)::int AS n FROM schema_migrations WHERE version=83')).rows[0].n as number

  const createLegacySchema008 = async () => {
    await activePool().query(`
      CREATE TABLE shared_orders (
        id uuid PRIMARY KEY,
        control_tenant_id uuid NOT NULL REFERENCES tenants(id),
        idempotency_key text NOT NULL,
        quote jsonb NOT NULL,
        status text NOT NULL CHECK (status IN ('pending','paid','cancelled','paid_not_ready','provisioned')),
        payment_attempts bigint NOT NULL DEFAULT 0 CHECK (payment_attempts >= 0),
        provision_job_id uuid,
        created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        paid_at timestamptz
      );
      CREATE UNIQUE INDEX shared_orders_idempotency ON shared_orders(idempotency_key);
      CREATE FUNCTION shared_order_quote_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'orders are permanent'; END IF;
        RETURN NEW;
      END; $$;
      CREATE TRIGGER shared_order_identity BEFORE UPDATE OR DELETE ON shared_orders
        FOR EACH ROW EXECUTE FUNCTION shared_order_quote_immutable();
      CREATE TABLE shared_payment_events (
        event_id text NOT NULL,
        order_id uuid NOT NULL REFERENCES shared_orders(id),
        kind text NOT NULL CHECK (kind IN ('payment_intent.succeeded','payment_intent.payment_failed','payment_intent.canceled')),
        payload jsonb NOT NULL,
        first_seen timestamptz NOT NULL DEFAULT clock_timestamp(),
        PRIMARY KEY (event_id)
      );
    `)
  }

  it('leaves a fresh database with no Package-6 order object and records version 83 once', async () => {
    const p = activePool()
    await migrate(p)
    await expectNoPackage6OrderObjects(p)
    expect(await applied()).toBe(1)
    await migrate(p)
    expect(await applied()).toBe(1)
  })

  it('refuses while shared_orders still has a row, and succeeds once it is cleared', async () => {
    const p = activePool()
    await migrate(p)
    await createLegacySchema008()
    const tenant = randomUUID(), order = randomUUID()
    await p.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,'Order tenant','saas','shared_managed',$2,false)", [tenant, `order-${tenant}`])
    await p.query("INSERT INTO shared_orders(id,control_tenant_id,idempotency_key,quote,status) VALUES($1,$2,'pkg6-guard','{}'::jsonb,'pending')", [order, tenant])
    await p.query('DELETE FROM schema_migrations WHERE version=83')
    await expect(migrate(p)).rejects.toThrow(/1 row\(s\) still exist in the retired Package-6 sandbox table.*shared_order_identity.*migrate again/)
    expect(await applied()).toBe(0)
    expect((await p.query('SELECT count(*)::int AS n FROM shared_orders WHERE id=$1', [order])).rows[0].n).toBe(1)
    await p.query('ALTER TABLE shared_orders DISABLE TRIGGER shared_order_identity')
    await p.query('DELETE FROM shared_orders')
    await p.query('ALTER TABLE shared_orders ENABLE TRIGGER shared_order_identity')
    await migrate(p)
    expect(await applied()).toBe(1)
    await expectNoPackage6OrderObjects(p)
    expect((await p.query('SELECT count(*)::int AS n FROM tenants WHERE id=$1', [tenant])).rows[0].n).toBe(1)
  })

  it('refuses while shared_payment_events still has a row, and succeeds once it is cleared', async () => {
    const p = activePool()
    await migrate(p)
    await createLegacySchema008()
    const tenant = randomUUID(), order = randomUUID()
    await p.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,'Event tenant','saas','shared_managed',$2,false)", [tenant, `event-${tenant}`])
    await p.query("INSERT INTO shared_orders(id,control_tenant_id,idempotency_key,quote,status) VALUES($1,$2,'pkg6-event-guard','{}'::jsonb,'paid')", [order, tenant])
    await p.query("INSERT INTO shared_payment_events(event_id,order_id,kind,payload) VALUES('evt_guard',$1,'payment_intent.succeeded','{}'::jsonb)", [order])
    await p.query('DELETE FROM schema_migrations WHERE version=83')
    await expect(migrate(p)).rejects.toThrow(/migration 83 refuses to drop shared_payment_events: 1 row\(s\) still exist.*migrate again/)
    expect(await applied()).toBe(0)
    expect((await p.query("SELECT count(*)::int AS n FROM shared_payment_events WHERE event_id='evt_guard'")).rows[0].n).toBe(1)
    await p.query('DELETE FROM shared_payment_events')
    await p.query('ALTER TABLE shared_orders DISABLE TRIGGER shared_order_identity')
    await p.query('DELETE FROM shared_orders')
    await p.query('ALTER TABLE shared_orders ENABLE TRIGGER shared_order_identity')
    await migrate(p)
    expect(await applied()).toBe(1)
    await expectNoPackage6OrderObjects(p)
    expect((await p.query('SELECT count(*)::int AS n FROM tenants WHERE id=$1', [tenant])).rows[0].n).toBe(1)
  })

  it('drops every object of a database that applied the old version 8, without CASCADE', async () => {
    const p = activePool()
    await migrate(p)
    await createLegacySchema008()
    const tenant = randomUUID()
    await p.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,'Legacy empty order tenant','saas','shared_managed',$2,false)", [tenant, `legacy-empty-${tenant}`])
    await p.query('DELETE FROM schema_migrations WHERE version=83')
    await migrate(p)
    expect(await applied()).toBe(1)
    await expectNoPackage6OrderObjects(p)
    expect((await p.query('SELECT count(*)::int AS n FROM tenants WHERE id=$1', [tenant])).rows[0].n).toBe(1)
  })
})
