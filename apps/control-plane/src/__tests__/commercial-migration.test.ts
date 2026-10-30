import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { randomUUID, createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { migrate } from '../db.js'
import { resolvePackageAuthority, resolvePackageJobAuthority } from '../packages.js'
import { seedPublishedPackage } from './package-fixtures.js'
import { bindJob, payloadDigest, businessKey } from '../shared/provisioning.js'
import { migrateLegacyToSaas, effectivePolicyHashes, tenantRowSnapshot, uuidv5 } from '../commercial/legacy-mapping.js'
import { vendorAccount, replaceRoles } from './helpers/vendor-session.js'
import { vendorActorIssuer } from '../admin-auth/grants.js'

const url = process.env.CONTROL_TEST_DATABASE_URL
if (url) { const p = new URL(url); if (!['127.0.0.1', 'localhost', '::1'].includes(p.hostname) || !/^liwan_control_scratch_[a-z0-9]+$/.test(p.pathname.slice(1))) throw Error('scratch control DB required') }
const suite = url ? describe : describe.skip
const repositoryRoot = fileURLToPath(new URL('../../../..', import.meta.url))
const sql = (n: string) => readFile(new URL(`../${n}`, import.meta.url), 'utf8')
const COMMERCIAL_ZERO = ['orders', 'invoices', 'invoice_lines', 'payment_attempts', 'payment_events', 'commercial_quotes', 'subscription_revisions', 'renewals']

suite('legacy → SaaS commercial migration (C1)', () => {
  const pool = new Pool({ connectionString: url, max: 6 })
  const actor = { issuer: vendorActorIssuer(`c1-${randomUUID()}`), actorUid: 7 }
  const reason = 'Legacy migration fixture'
  const T = { catalogOnly: randomUUID(), pkg: randomUUID(), nonSaas: randomUUID(), noBilling: randomUUID(), zero: randomUUID(), commercial: randomUUID(), enrolling: randomUUID() }
  const commercialCustomers = { bound: randomUUID(), enrolling: randomUUID() }
  let version = '', pkgAuthority: any, pkgJob: any, pkgRevision: any
  let runningJobId = '', jobCountBefore = 0, publishedIds: string[] = [], tenantsBefore: string[] = [], policyBefore: Record<string, string> = {}

  async function insertPackage(status: 'draft' | 'validated' | 'published', available: boolean, limits: Record<string, number | null>, name: string) {
    const pkgId = randomUUID(), id = randomUUID(), digest = createHash('sha256').update(id).digest('hex')
    await pool.query('INSERT INTO commercial_packages(id) VALUES($1)', [pkgId])
    await pool.query(`INSERT INTO package_revisions(id,package_id,version,name,description,status,available,catalog_version,catalog_tier,source_sha256,limits,modules,features,content_digest,validated_digest,published_at)
      VALUES($1,$2,1,$3,'d',$4,$5,$6,'projects',$7,$8,'[]','[]',$9,$10,$11)`,
      [id, pkgId, name, status, available, version, 'b'.repeat(64), JSON.stringify(limits), digest, status === 'draft' ? null : digest, status === 'published' ? new Date() : null])
    return id
  }
  async function addTenant(id: string, over: Record<string, any> = {}) {
    const t = { mode: 'saas', hosting: 'managed', catalog_version: null, catalog_tier: null, package: null, desired: null, observed: null, rev: null, ...over }
    await pool.query(`INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,catalog_version,catalog_tier,package_revision_id,desired_policy,observed_policy,policy_revision,operations_enabled)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true)`, [id, `Tenant ${id.slice(0, 6)}`, t.mode, t.hosting, `inv-${id}`, t.catalog_version, t.catalog_tier, t.package, t.desired, t.observed, t.rev])
  }
  async function binding(tenant: string) {
    const slug = `t${tenant.replaceAll('-', '')}`, database = `liwan_scratch_${tenant.replaceAll('-', '')}`
    await pool.query('INSERT INTO shared_registry_bindings(control_tenant_id,tenant_id,host,database_name,filestore,enabled,registry_revision) VALUES($1,$2,$3,$4,$4,false,1)', [tenant, slug, `${slug}.c1.test`, database])
    return { slug, database }
  }
  const mappings = async () => (await pool.query('SELECT source_kind,source_id,target_kind,target_id,source_payload,source_digest FROM legacy_mappings ORDER BY source_kind,source_id')).rows
  const countOf = async (t: string) => (await pool.query(`SELECT count(*)::int n FROM ${t}`)).rows[0].n as number

  beforeAll(async () => {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
    await migrate(pool)
    const raw = await readFile(new URL('../../../../deploy/catalog/solutions/platform.json', import.meta.url))
    version = `c1-${randomUUID()}`
    await pool.query("INSERT INTO catalog_entries(id,version,status,solution,source_sha256) VALUES($1,$2,'published',$3,$4)", [randomUUID(), version, JSON.parse(raw.toString()), createHash('sha256').update(raw).digest('hex')])
    await vendorAccount(pool, ['product', 'customer_success', 'operations'], 7)

    // real published package (seeded with its exact digest) pinned by a tenant, then withdrawn
    const input = { name: 'Legacy projects', description: 'pinned', catalog_version: version, catalog_tier: 'projects', limits: { 'users.limit': 3, 'storage.limit_mb': 2, 'projects.max_projects': 1 } }
    pkgRevision = await seedPublishedPackage(pool, input)
    pkgAuthority = await resolvePackageAuthority(pool, pkgRevision.id, true, { repositoryRoot })
    const pol = { schema_version: 1, features: { a: 1 } }
    await addTenant(T.pkg, { catalog_version: version, catalog_tier: 'projects', package: pkgRevision.id, desired: pol, observed: { ...pol, observed: true }, rev: 3 })
    const b = await binding(T.pkg)
    pkgJob = bindJob({ schemaVersion: 1, operation: 'provision', requestId: randomUUID(), binding: { tenantId: b.slug, database: b.database, filestore: b.database, registryRevision: 1 }, catalog: pkgAuthority.catalog, policy: pkgAuthority.policy, packageAuthority: pkgAuthority })
    await pool.query('INSERT INTO shared_jobs(id,control_tenant_id,business_key,payload,payload_digest,issuer,actor_uid,reason) VALUES($1,$2,$3,$4,$5,$6,7,$7)', [randomUUID(), T.pkg, businessKey(pkgJob), pkgJob, payloadDigest(pkgJob), actor.issuer, reason])
    await pool.query('UPDATE package_revisions SET available=false,revision=revision+1 WHERE id=$1', [pkgRevision.id]) // withdrawn
    // draft / validated / published(limits 0 + null)
    await insertPackage('draft', false, { 'users.limit': 1 }, 'draft')
    await insertPackage('validated', false, { 'users.limit': 1 }, 'validated')
    const zero = await insertPackage('published', true, { 'users.limit': 0, 'storage.limit_mb': null, 'projects.max_projects': 0 }, 'zero-null')
    await addTenant(T.zero, { catalog_version: version, catalog_tier: 'projects', package: zero, desired: { limits: 0 } })
    // catalog-only tenant with a running shared job
    await addTenant(T.catalogOnly, { catalog_version: version, catalog_tier: 'projects', desired: { x: 1 } })
    const cb = await binding(T.catalogOnly)
    runningJobId = randomUUID()
    await pool.query(`INSERT INTO shared_jobs(id,control_tenant_id,business_key,payload,payload_digest,issuer,actor_uid,reason,state,attempt_id,fence,lease_until)
      VALUES($1,$2,$7,$3,$4,$5,7,'run','running',$6,1,now()+interval '1 hour')`, [runningJobId, T.catalogOnly, { operation: 'provision', binding: cb }, 'a'.repeat(64), actor.issuer, randomUUID(), `run-${runningJobId}`])
    await addTenant(T.noBilling) // no catalog, no policy, no billing at all
    await addTenant(T.nonSaas, { mode: 'non_saas', hosting: 'customer_hosted', desired: { n: 1 } })
    // tenants the commercial journey provisioned: one bound to its customer, one still being enrolled
    await addTenant(T.commercial, { catalog_version: version, catalog_tier: 'projects', desired: { c: 1 } })
    await pool.query('INSERT INTO customers(id,name,tenant_id) VALUES($1,$2,$3)', [commercialCustomers.bound, 'Commercial bound', T.commercial])
    await pool.query("INSERT INTO subscriptions(id,customer_id,tenant_id,state) VALUES($1,$2,$3,'active')", [randomUUID(), commercialCustomers.bound, T.commercial])
    await addTenant(T.enrolling)
    await pool.query('INSERT INTO customers(id,name,enrollment_request_id) VALUES($1,$2,$3)', [commercialCustomers.enrolling, 'Commercial enrolling', T.enrolling])

    publishedIds = (await pool.query("SELECT id FROM package_revisions WHERE status='published' ORDER BY id")).rows.map(r => r.id)
    tenantsBefore = await tenantRowSnapshot(pool)
    policyBefore = await effectivePolicyHashes(pool)
    jobCountBefore = await countOf('shared_jobs')
  })
  afterAll(async () => { await pool.end() })

  it('dry-run reports counts, writes nothing, and leaves no run row', async () => {
    const before = { m: await countOf('legacy_mappings'), c: await countOf('customers'), s: await countOf('subscriptions'), b: await countOf('bundle_revisions'), r: await countOf('catalog_releases'), runs: await countOf('migration_runs') }
    const rep = await migrateLegacyToSaas(pool, { mode: 'dry_run' })
    expect(rep.counts).toEqual({ saas_package: 2, saas_catalog_only: 2, saas_commercial: 2, non_saas: 1, package_published: 2, package_skipped: 2, errors: 0 })
    expect(rep.errors).toEqual([])
    expect({ m: await countOf('legacy_mappings'), c: await countOf('customers'), s: await countOf('subscriptions'), b: await countOf('bundle_revisions'), r: await countOf('catalog_releases'), runs: await countOf('migration_runs') }).toEqual(before)
    expect(await tenantRowSnapshot(pool)).toEqual(tenantsBefore)
  })

  it('interrupt after N rows then resume converges; rerun is identical', async () => {
    await expect(migrateLegacyToSaas(pool, { mode: 'run', afterRow: n => { if (n === 3) throw new Error('simulated_interrupt') } })).rejects.toThrow('simulated_interrupt')
    const partial = await countOf('legacy_mappings')
    expect(partial).toBe(3)
    const resumed = await migrateLegacyToSaas(pool, { mode: 'run' })
    expect(resumed.errors).toEqual([])
    expect(resumed.counts.errors).toBe(0)
    const final1 = await mappings()
    expect(final1).toHaveLength(9) // 4 packages + 5 tenants
    const rerun = await migrateLegacyToSaas(pool, { mode: 'run' })
    expect(rerun.source_digest).toBe(resumed.source_digest)
    expect(rerun.counts).toEqual(resumed.counts)
    expect(rerun.created).toEqual({})
    expect(await mappings()).toEqual(final1)
    const done = await pool.query("SELECT counts,completed_at FROM migration_runs WHERE run_id=$1", [rerun.run_id])
    expect(done.rows[0].completed_at).not.toBeNull()
  })

  it('maps package revisions: published → private unavailable bundle; draft/validated skipped', async () => {
    const m = await mappings()
    const pk = m.filter(x => x.source_kind === 'package_revision')
    expect(pk.filter(x => x.target_kind === 'none')).toHaveLength(2)
    const bundles = pk.filter(x => x.target_kind === 'bundle_revision')
    expect(bundles.map(x => x.source_id).sort()).toEqual(publishedIds)
    for (const b of bundles) {
      const r = (await pool.query('SELECT br.*, cr.catalog_version FROM bundle_revisions br JOIN catalog_releases cr ON cr.id=br.catalog_release_id WHERE br.id=$1', [b.target_id])).rows[0]
      expect(r.status).toBe('published'); expect(r.available).toBe(false)
      expect(r.audience.kind).toBe('customer'); expect(r.audience_customer_id).toMatch(/^legacy:/)
      expect(r.catalog_version).toBe(version)
      expect(b.source_payload).toMatchObject({ source_sha256: expect.any(String), content_digest: expect.any(String), package_id: expect.any(String), version: 1 })
    }
    const zero = bundles.find(x => x.source_payload.limits['users.limit'] === 0)!
    expect(zero.source_payload.limits).toEqual({ 'users.limit': 0, 'storage.limit_mb': null, 'projects.max_projects': 0 }) // 0 and null preserved
    expect(await countOf('bundle_revisions')).toBe(2)
  })

  it('creates customers pending+setup_required for saas tenants only; non-saas excluded', async () => {
    const saas = [T.catalogOnly, T.pkg, T.noBilling, T.zero]
    const cu = (await pool.query('SELECT * FROM customers WHERE NOT (id = ANY($1::uuid[])) ORDER BY id', [Object.values(commercialCustomers)])).rows
    expect(cu).toHaveLength(4)
    for (const t of saas) {
      const c = cu.find(x => x.tenant_id === t)!
      expect(c.id).toBe(uuidv5(`customer:${t}`)); expect(c.commercial_setup_required).toBe(true)
      const s = (await pool.query('SELECT * FROM subscriptions WHERE customer_id=$1', [c.id])).rows[0]
      expect(s.state).toBe('pending'); expect(s.applied_revision_id).toBeNull(); expect(s.target_revision_id).toBeNull()
      expect(s.legacy_source).toHaveProperty('observed_policy_digest')
    }
    const p = (await pool.query('SELECT legacy_source FROM subscriptions WHERE tenant_id=$1', [T.pkg])).rows[0].legacy_source
    expect(p).toMatchObject({ catalog_version: version, catalog_tier: 'projects', package_revision_id: pkgRevision.id, policy_revision: 3 })
    expect((await mappings()).find(x => x.source_id === T.nonSaas)!.target_kind).toBe('excluded_non_saas')
    expect(cu.find(x => x.tenant_id === T.nonSaas)).toBeUndefined()
  })

  it('skips commercially provisioned tenants: no mapping, customer or subscription is written for them', async () => {
    const ids = [T.commercial, T.enrolling]
    expect((await mappings()).filter(x => ids.includes(x.source_id))).toEqual([])
    const owned = (await pool.query('SELECT id,tenant_id,enrollment_request_id,commercial_setup_required FROM customers WHERE tenant_id = ANY($1::uuid[]) OR enrollment_request_id = ANY($1::uuid[]) ORDER BY name', [ids])).rows
    expect(owned).toEqual([
      { id: commercialCustomers.bound, tenant_id: T.commercial, enrollment_request_id: null, commercial_setup_required: false },
      { id: commercialCustomers.enrolling, tenant_id: null, enrollment_request_id: T.enrolling, commercial_setup_required: false },
    ])
    expect((await pool.query('SELECT customer_id,state,legacy_source FROM subscriptions WHERE tenant_id = ANY($1::uuid[])', [ids])).rows)
      .toEqual([{ customer_id: commercialCustomers.bound, state: 'active', legacy_source: null }])
    const rerun = await migrateLegacyToSaas(pool, { mode: 'run' })
    expect(rerun.errors).toEqual([]); expect(rerun.counts.saas_commercial).toBe(2); expect(rerun.created).toEqual({})
    expect(rerun.skipped_commercial.sort()).toEqual([...ids].sort())
  })

  it('creates no quote/order/invoice/payment rows and leaves tenants, policies and shared jobs untouched', async () => {
    for (const t of COMMERCIAL_ZERO) expect(await countOf(t)).toBe(0)
    expect(await tenantRowSnapshot(pool)).toEqual(tenantsBefore)
    expect(await effectivePolicyHashes(pool)).toEqual(policyBefore)
    expect(await countOf('shared_jobs')).toBe(jobCountBefore)
    expect((await pool.query('SELECT state FROM shared_jobs WHERE id=$1', [runningJobId])).rows[0].state).toBe('running')
  })

  it('legacy package job authority still resolves for the migrated tenant', async () => {
    expect(await resolvePackageJobAuthority(pool, pkgJob)).toEqual(pkgAuthority)
  })
  it('honours a commercial enrollment that appears after the inventory and counts it as commercial', async () => {
    const late = randomUUID(), customer = randomUUID()
    await addTenant(late)
    const report = await migrateLegacyToSaas(pool, { mode: 'run', afterRow: async n => {
      if (n === 1) await pool.query('INSERT INTO customers(id,name,enrollment_request_id) VALUES($1,$2,$3)', [customer, 'Late enrolment', late])
    } })
    expect(report.errors).toEqual([])
    expect(report.skipped_commercial).toContain(late)
    expect(report.counts).toMatchObject({ saas_catalog_only: 2, saas_commercial: 3 })
    expect((await pool.query('SELECT id FROM customers WHERE tenant_id=$1 OR enrollment_request_id=$1', [late])).rows).toEqual([{ id: customer }])
    expect((await mappings()).filter(x => x.source_id === late)).toEqual([])
  })

  it('reports, never skips, a tenant whose ownership is not proven or is contested', async () => {
    const boundOnly = randomUUID(), contested = randomUUID()
    await addTenant(boundOnly)
    await pool.query('INSERT INTO customers(id,name,tenant_id) VALUES($1,$2,$3)', [randomUUID(), 'Bound without subscription', boundOnly])
    await addTenant(contested)
    await pool.query('INSERT INTO customers(id,name,tenant_id) VALUES($1,$2,$3)', [uuidv5(`customer:${contested}`), 'Legacy', contested])
    await pool.query('INSERT INTO customers(id,name,enrollment_request_id) VALUES($1,$2,$3)', [randomUUID(), 'Enrolling', contested])
    const report = await migrateLegacyToSaas(pool, { mode: 'dry_run' })
    expect(report.errors.sort((a, b) => a.source_id.localeCompare(b.source_id))).toEqual([
      { source_kind: 'tenant', source_id: boundOnly, code: 'customer_conflict' },
      { source_kind: 'tenant', source_id: contested, code: 'ownership_conflict' },
    ].sort((a, b) => a.source_id.localeCompare(b.source_id)))
    expect(report.skipped_commercial).not.toContain(boundOnly)
    expect(report.skipped_commercial).not.toContain(contested)
  })
})
