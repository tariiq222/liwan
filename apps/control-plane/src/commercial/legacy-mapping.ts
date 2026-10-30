import { createHash, randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { canonicalJson } from '@liwan/commercial-contracts'
import { createRelease } from './catalog-releases.js'
import { bundleContent } from './bundles.js'
import { digestOf, type CommercialActor } from './lifecycle.js'

/** Fixed namespace for deterministic legacy-migration identifiers (RFC 4122 UUIDv5). */
export const LEGACY_NAMESPACE = '6f1c3d8e-c1c1-4000-8000-00000000c001'
export function uuidv5(name: string, namespace = LEGACY_NAMESPACE): string {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex')
  const h = createHash('sha1').update(ns).update(name, 'utf8').digest()
  h[6] = (h[6]! & 0x0f) | 0x50
  h[8] = (h[8]! & 0x3f) | 0x80
  const x = h.subarray(0, 16).toString('hex')
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`
}
const sha = (v: unknown) => createHash('sha256').update(canonicalJson(v)).digest('hex')
const ACTOR: CommercialActor = { issuer: 'legacy-migration', actorUid: 1 }

export type MigrationCounts = { saas_package: number; saas_catalog_only: number; saas_commercial: number; non_saas: number; package_published: number; package_skipped: number; errors: number }
export type RowError = { source_kind: string; source_id: string; code: string }
export type MigrationReport = { mode: 'dry_run' | 'run'; run_id: string; source_digest: string; counts: MigrationCounts; errors: RowError[]; created: Record<string, number>; skipped_commercial: string[] }
export type MigrateOptions = { mode: 'dry_run' | 'run'; afterRow?: (rowsProcessed: number) => void | Promise<void> }

type Row = Record<string, any>
type Item =
  | { kind: 'package_revision'; row: Row; digest: string }
  | { kind: 'tenant'; row: Row; digest: string; commercialCustomerId?: string }

const PKG_COLS = 'id,package_id,version,name,description,status,available,catalog_version,catalog_tier,source_sha256,limits,modules,features,content_digest'
const TENANT_COLS = 'id,name,commercial_mode,hosting_model,catalog_version,catalog_tier,package_revision_id,desired_policy,observed_policy,policy_revision'

async function loadInventory(q: Pool | PoolClient): Promise<Item[]> {
  const pk = await q.query(`SELECT ${PKG_COLS} FROM package_revisions ORDER BY id`)
  const tn = await q.query(`SELECT ${TENANT_COLS} FROM tenants ORDER BY id`)
  const owners = await commercialOwnership(q)
  return [
    ...pk.rows.map(row => ({ kind: 'package_revision' as const, row, digest: sha(row) })),
    ...tn.rows.map(row => {
      const commercialCustomerId = row.commercial_mode === 'saas' ? owners.get(row.id)?.owner : undefined
      return { kind: 'tenant' as const, row, digest: sha(row), ...(commercialCustomerId ? { commercialCustomerId } : {}) }
    }),
  ]
}

type Ownership = { owner?: string; conflict?: true }
/** Tenants the commercial journey already owns, so they are not legacy: a customer other than the
 * legacy one enrolled the tenant (the enrollment request id is the tenant id) or holds a subscription
 * on it. A customer merely bound by tenant_id is not proof; it stays a customer_conflict. A tenant with
 * both the legacy customer and a commercial one is an ownership_conflict. */
async function commercialOwnership(q: Pool | PoolClient, tenantId?: string): Promise<Map<string, Ownership>> {
  const r = await q.query(`SELECT t.id AS tenant_id, c.id AS customer_id,
      (c.enrollment_request_id=t.id OR EXISTS(SELECT 1 FROM subscriptions s WHERE s.customer_id=c.id AND s.tenant_id=t.id)) AS commercial
    FROM tenants t JOIN customers c ON c.tenant_id=t.id OR c.enrollment_request_id=t.id
    WHERE ($1::uuid IS NULL OR t.id=$1::uuid) ORDER BY t.id, c.id`, [tenantId ?? null])
  const legacy = new Set<string>(), owners = new Map<string, Ownership>()
  for (const row of r.rows) {
    if (row.customer_id === uuidv5(`customer:${row.tenant_id}`)) legacy.add(row.tenant_id)
    else if (row.commercial && !owners.has(row.tenant_id)) owners.set(row.tenant_id, { owner: row.customer_id })
  }
  for (const id of legacy) if (owners.has(id)) owners.set(id, { conflict: true })
  return owners
}
export const inventoryDigest = (items: Item[]) => sha(items.map(i => [i.kind, i.row.id, i.digest]))

/** Effective policy per tenant (observed_policy ?? desired_policy) hashed; for before/after assertions. */
export async function effectivePolicyHashes(q: Pool | PoolClient): Promise<Record<string, string>> {
  const r = await q.query('SELECT id, desired_policy, observed_policy FROM tenants ORDER BY id')
  return Object.fromEntries(r.rows.map(t => [t.id, sha(t.observed_policy ?? t.desired_policy ?? null)]))
}
export async function tenantRowSnapshot(q: Pool | PoolClient): Promise<string[]> {
  const r = await q.query('SELECT row_to_json(t)::text AS j FROM tenants t ORDER BY id')
  return r.rows.map(x => x.j)
}

export function classify(items: Item[]): MigrationCounts {
  const c: MigrationCounts = { saas_package: 0, saas_catalog_only: 0, saas_commercial: 0, non_saas: 0, package_published: 0, package_skipped: 0, errors: 0 }
  for (const i of items) {
    if (i.kind === 'package_revision') i.row.status === 'published' ? c.package_published++ : c.package_skipped++
    else if (i.row.commercial_mode !== 'saas') c.non_saas++
    else if (i.commercialCustomerId) c.saas_commercial++
    else i.row.package_revision_id ? c.saas_package++ : c.saas_catalog_only++
  }
  return c
}

async function recordMapping(c: PoolClient, kind: string, id: string, targetKind: string, targetId: string | null, payload: unknown, digest: string, created: Record<string, number>) {
  const ins = await c.query(`INSERT INTO legacy_mappings(source_kind,source_id,target_kind,target_id,source_payload,source_digest)
    VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(source_kind,source_id) DO NOTHING RETURNING 1`, [kind, id, targetKind, targetId, JSON.stringify(payload), digest])
  if (ins.rowCount) { created.mappings = (created.mappings ?? 0) + 1; return }
  const ex = (await c.query('SELECT target_kind,target_id,source_digest FROM legacy_mappings WHERE source_kind=$1 AND source_id=$2', [kind, id])).rows[0]
  if (ex.source_digest !== digest || ex.target_kind !== targetKind || ex.target_id !== targetId) throw new Error('mapping_conflict')
}

async function migratePackage(pool: Pool, c: PoolClient, item: Item, dry: boolean, created: Record<string, number>) {
  const p = item.row
  if (p.status !== 'published') { await recordMapping(c, 'package_revision', p.id, 'none', null, { status: p.status }, item.digest, created); return }
  const bundleRevisionId = uuidv5(`bundle_revision:${p.id}`)
  const bundleId = uuidv5(`bundle:${p.package_id}`)
  let releaseId: string | undefined
  if (!dry) releaseId = (await createRelease(pool, ACTOR, { catalog_version: p.catalog_version, reason: 'Legacy package migration' }).catch(() => { throw new Error('catalog_release_unavailable') })).release.id
  else {
    const r = await c.query('SELECT id FROM catalog_releases WHERE catalog_version=$1', [p.catalog_version])
    if (r.rowCount) releaseId = r.rows[0].id
    else if (!(await c.query("SELECT 1 FROM catalog_entries WHERE version=$1 AND status='published'", [p.catalog_version])).rowCount) throw new Error('catalog_release_unavailable')
  }
  const legacy = { package_id: p.package_id, version: p.version, content_digest: p.content_digest, source_sha256: p.source_sha256, catalog_tier: p.catalog_tier, limits: p.limits, legacy_available: p.available }
  if (releaseId) {
    const audience = { kind: 'customer', customer_id: `legacy:${p.package_id}` } // private legacy marker; never public
    const row = { id: bundleRevisionId, bundle_id: bundleId, version: p.version, name: p.name, description: p.description, audience, catalog_release_id: releaseId, selections: [], domain_limits: {}, prices: [] }
    const digest = digestOf(bundleContent(row))
    await c.query('INSERT INTO commercial_bundles(id,next_version) VALUES($1,$2) ON CONFLICT(id) DO NOTHING', [bundleId, 2])
    await c.query('UPDATE commercial_bundles SET next_version=GREATEST(next_version,$2) WHERE id=$1', [bundleId, p.version + 1])
    const ins = await c.query(`INSERT INTO bundle_revisions(id,bundle_id,version,name,description,audience,audience_customer_id,status,available,catalog_release_id,selections,domain_limits,prices,content_digest,validated_digest,published_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,'published',false,$8,'[]','{}','[]',$9,$9,now()) ON CONFLICT(id) DO NOTHING RETURNING 1`,
      [bundleRevisionId, bundleId, p.version, p.name, p.description, JSON.stringify(audience), audience.customer_id, releaseId, digest])
    if (ins.rowCount) created.bundles = (created.bundles ?? 0) + 1
    else if ((await c.query('SELECT content_digest FROM bundle_revisions WHERE id=$1', [bundleRevisionId])).rows[0].content_digest !== digest) throw new Error('bundle_conflict')
  }
  await recordMapping(c, 'package_revision', p.id, 'bundle_revision', bundleRevisionId, legacy, item.digest, created)
}

async function migrateTenant(c: PoolClient, item: Item, created: Record<string, number>): Promise<'migrated' | 'skipped_commercial'> {
  const t = item.row
  if (t.commercial_mode !== 'saas') { await recordMapping(c, 'tenant', t.id, 'excluded_non_saas', null, { commercial_mode: t.commercial_mode, hosting_model: t.hosting_model }, item.digest, created); return 'migrated' }
  // A commercially provisioned tenant already has its own customer: skip it and write nothing. Decided
  // inside the row transaction, so an ownership that appeared after the inventory is honoured too.
  const ownership = (await commercialOwnership(c, t.id)).get(t.id)
  if (ownership?.conflict) throw new Error('ownership_conflict')
  if (ownership?.owner) return 'skipped_commercial'
  const customerId = uuidv5(`customer:${t.id}`), subscriptionId = uuidv5(`subscription:${t.id}`)
  const legacySource = { catalog_version: t.catalog_version, catalog_tier: t.catalog_tier, package_revision_id: t.package_revision_id, policy_revision: t.policy_revision, observed_policy_digest: sha(t.observed_policy ?? null) }
  const cu = await c.query('INSERT INTO customers(id,name,tenant_id,commercial_setup_required) VALUES($1,$2,$3,true) ON CONFLICT DO NOTHING RETURNING 1', [customerId, t.name, t.id])
  if (cu.rowCount) created.customers = (created.customers ?? 0) + 1
  else if (!(await c.query('SELECT 1 FROM customers WHERE id=$1 AND tenant_id=$2', [customerId, t.id])).rowCount) throw new Error('customer_conflict')
  const sb = await c.query(`INSERT INTO subscriptions(id,customer_id,tenant_id,state,legacy_source) VALUES($1,$2,$3,'pending',$4) ON CONFLICT DO NOTHING RETURNING 1`, [subscriptionId, customerId, t.id, JSON.stringify(legacySource)])
  if (sb.rowCount) created.subscriptions = (created.subscriptions ?? 0) + 1
  else if (!(await c.query('SELECT 1 FROM subscriptions WHERE id=$1 AND customer_id=$2', [subscriptionId, customerId])).rowCount) throw new Error('subscription_conflict')
  await recordMapping(c, 'tenant', t.id, 'customer', customerId, legacySource, item.digest, created)
  return 'migrated'
}

export async function migrateLegacyToSaas(pool: Pool, opts: MigrateOptions): Promise<MigrationReport> {
  const dry = opts.mode === 'dry_run'
  const items = await loadInventory(pool)
  const counts = classify(items)
  const errors: RowError[] = []
  const created: Record<string, number> = {}
  const skipped_commercial: string[] = []
  const run_id = randomUUID(), source_digest = inventoryDigest(items)
  const started = new Date()
  const client = await pool.connect()
  try {
    if (dry) await client.query('BEGIN')
    else await client.query('INSERT INTO migration_runs(run_id,mode,source_digest,started_at) VALUES($1,$2,$3,$4)', [run_id, opts.mode, source_digest, started])
    let n = 0
    for (const item of items) {
      try {
        await client.query(dry ? 'SAVEPOINT row' : 'BEGIN')
        let outcome: 'migrated' | 'skipped_commercial' = 'migrated'
        if (item.kind === 'package_revision') await migratePackage(pool, client, item, dry, created)
        else outcome = await migrateTenant(client, item, created)
        await client.query(dry ? 'RELEASE SAVEPOINT row' : 'COMMIT')
        if (item.kind === 'tenant' && item.row.commercial_mode === 'saas') {
          if (outcome === 'skipped_commercial') skipped_commercial.push(item.row.id)
          // The row decision wins over the inventory classification when ownership changed in between.
          const moved = Number(outcome === 'skipped_commercial') - Number(Boolean(item.commercialCustomerId))
          counts.saas_commercial += moved
          if (item.row.package_revision_id) counts.saas_package -= moved
          else counts.saas_catalog_only -= moved
        }
      } catch (e) {
        await client.query(dry ? 'ROLLBACK TO SAVEPOINT row' : 'ROLLBACK')
        // A failed row is not commercial: return it to its legacy category, where its error belongs.
        if (item.kind === 'tenant' && item.commercialCustomerId) {
          counts.saas_commercial--
          if (item.row.package_revision_id) counts.saas_package++
          else counts.saas_catalog_only++
        }
        errors.push({ source_kind: item.kind, source_id: item.row.id, code: e instanceof Error ? e.message.slice(0, 80) : 'error' })
      }
      n++
      await opts.afterRow?.(n)
    }
    counts.errors = errors.length
    if (dry) await client.query('ROLLBACK')
    else await client.query('UPDATE migration_runs SET counts=$2,errors=$3,completed_at=now() WHERE run_id=$1', [run_id, JSON.stringify(counts), JSON.stringify(errors)])
  } catch (e) {
    if (dry) await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally { client.release() }
  return { mode: opts.mode, run_id, source_digest, counts, errors, created, skipped_commercial }
}
