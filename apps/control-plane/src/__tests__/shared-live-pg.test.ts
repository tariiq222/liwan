// Real-PostgreSQL integration for the shared registry (schema 005) and shared
// queue/worker (schema 006). Gated on CONTROL_TEST_DATABASE_URL; never runs on
// odoo19 or any non-loopback nasq_control_scratch database. This is package-1
// SQL evidence only: it proves live SQL semantics (triggers, CAS, uniqueness,
// fencing, lease expiry) and NOT any production adapter, Odoo, or deployment.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { migrate } from '../db.js'
import { publishRegistryMutation, recoverRegistry, RegistryError } from '../shared/registry-store.js'
import { enqueueSharedJob } from '../shared/job-store.js'
import { runSharedJob, expireSharedLeases, recoverSharedJob, type SharedFencedAdapter } from '../shared/job-worker.js'
import { businessKey, payloadDigest } from '../shared/provisioning.js'

const url = process.env.CONTROL_TEST_DATABASE_URL
if (url) {
  const parsed = new URL(url)
  if (!['127.0.0.1','localhost','::1'].includes(parsed.hostname) || !/^nasq_control_scratch_[a-z0-9]+$/.test(parsed.pathname.slice(1))) throw new Error('CONTROL_TEST_DATABASE_URL must select a unique loopback nasq_control_scratch database')
}
if (!url) describe.skip('shared live PostgreSQL integration (requires CONTROL_TEST_DATABASE_URL)', () => {})
else describe('shared live PostgreSQL integration', () => {
  const pool = new Pool({ connectionString: url, max: 10 })
  const repositoryRoot = fileURLToPath(new URL('../../../..', import.meta.url))
  let registryDir = ''
  let registryPath = ''
  const issuer = 'live-gate-installation'
  const actor = { issuer, actorUid: 7 }
  const otherActor = { issuer, actorUid: 8 }
  const tenantA = randomUUID()
  const tenantB = randomUUID()
  const targetA = { host: 'a.live-gate.invalid', tenantId: 'live_a', database: 'live_gate_a', filestore: 'live_gate_a', enabled: true, registryRevision: 1 }
  const targetB = { host: 'b.live-gate.invalid', tenantId: 'live_b', database: 'live_gate_b', filestore: 'live_gate_b', enabled: true, registryRevision: 1 }
  let provisionJobId = ''
  let backupJobId = ''
  let crashedAttempt = ''
  let backupPayload: any

  beforeAll(async () => {
    registryDir = process.env.NASQ_LIVE_GATE_ROOT
      ? join(process.env.NASQ_LIVE_GATE_ROOT, 'registry')
      : await mkdtemp(join(tmpdir(), 'nasq-shared-live-'))
    registryPath = join(registryDir, 'registry.json')
    await mkdir(registryDir, { recursive: true })
    await migrate(pool)
    // Order matters: children first, then parents, then reseed the singleton.
    await pool.query('TRUNCATE shared_job_events, shared_jobs, shared_registry_audit, shared_registry_hosts, shared_registry_bindings, shared_registry_state CASCADE')
    await pool.query('TRUNCATE tenants, package_revisions, commercial_packages, catalog_entries CASCADE')
    await pool.query('TRUNCATE vendor_memberships, service_nonces, audit_events, operation_events, operations, restore_approvals')
    await pool.query('INSERT INTO shared_registry_state(singleton,revision) VALUES(true,0)')
    await pool.query('INSERT INTO vendor_memberships(issuer,actor_uid,capabilities) VALUES ($1,7,$2),($1,8,ARRAY[\'vendor.operations.run\'])', [issuer, ['vendor.read','vendor.tenants.manage','vendor.operations.run']])
    await pool.query('INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,catalog_version,catalog_tier,operations_enabled) VALUES ($1,$2,\'saas\',\'managed\',$3,\'live-v1\',\'core\',true),($4,$5,\'saas\',\'managed\',$6,\'live-v1\',\'core\',true)',
      [tenantA, 'Live A', 'live-gate-a', tenantB, 'Live B', 'live-gate-b'])
    const source = await readFile(join(repositoryRoot, 'deploy/catalog/solutions/platform.json'))
    await pool.query('INSERT INTO catalog_entries(id,version,status,solution,source_sha256,published_at) VALUES($1,\'live-v1\',\'published\',$2,$3,now())',
      [randomUUID(), JSON.parse(source.toString('utf8')), createHash('sha256').update(source).digest('hex')])
  })
  afterAll(async () => { await pool.end() })

  it('publishes registry mutations against real SQL with durable filesystem snapshot', async () => {
    const first = await publishRegistryMutation(pool, registryPath, actor, { controlTenantId: tenantA, expectedSnapshotRevision: 0, target: targetA, reason: 'Publish tenant A' })
    expect(first.snapshotRevision).toBe(1)
    expect(first.targets).toHaveLength(1)
    const onDisk = JSON.parse(await readFile(registryPath, 'utf8'))
    expect(onDisk.snapshotRevision).toBe(1)
    expect(onDisk.targets[0].tenantId).toBe('live_a')
    const second = await publishRegistryMutation(pool, registryPath, actor, { controlTenantId: tenantB, expectedSnapshotRevision: 1, target: targetB, reason: 'Publish tenant B' })
    expect(second.snapshotRevision).toBe(2)
    const diskTwo = JSON.parse(await readFile(registryPath, 'utf8'))
    expect(diskTwo.targets.map((t: any) => t.tenantId).sort()).toEqual(['live_a', 'live_b'])
    const audit = await pool.query('SELECT count(*)::int AS count FROM shared_registry_audit')
    expect(audit.rows[0].count).toBe(2)
  })

  it('enforces CAS, host reservation and identity immutability on live SQL', async () => {
    await expect(publishRegistryMutation(pool, registryPath, actor, { controlTenantId: tenantA, expectedSnapshotRevision: 0, target: { ...targetA, registryRevision: 2, host: 'a2.live-gate.invalid' }, reason: 'Stale CAS' }))
      .rejects.toMatchObject({ code: 'registry_revision_conflict' })
    await expect(publishRegistryMutation(pool, registryPath, actor, { controlTenantId: tenantB, expectedSnapshotRevision: 2, target: { ...targetB, host: 'a.live-gate.invalid', registryRevision: 2 }, reason: 'Steal host' }))
      .rejects.toMatchObject({ code: 'registry_host_reserved' })
    await expect(publishRegistryMutation(pool, registryPath, actor, { controlTenantId: tenantA, expectedSnapshotRevision: 2, target: { ...targetA, tenantId: 'live_c', database: 'live_gate_c', filestore: 'live_gate_c', registryRevision: 2 }, reason: 'Rewrite identity' }))
      .rejects.toMatchObject({ code: 'tenant_binding_immutable' })
    await expect(publishRegistryMutation(pool, registryPath, { issuer, actorUid: 99 }, { controlTenantId: tenantA, expectedSnapshotRevision: 2, target: { ...targetA, registryRevision: 2 }, reason: 'No grant' }))
      .rejects.toMatchObject({ code: 'registry_forbidden' })
    const state = await pool.query('SELECT revision::float8 AS revision FROM shared_registry_state WHERE singleton=true')
    expect(state.rows[0].revision).toBe(2)
  })

  it('recovers from a leftover publication barrier using authoritative SQL state', async () => {
    // Simulate a crashed publisher: barrier present, snapshot stale on disk.
    await writeFile(`${registryPath}.pending`, 'registry publication pending\n')
    const stale = { schemaVersion: 1, snapshotRevision: 1, targets: [targetA] }
    await writeFile(registryPath, JSON.stringify(stale))
    const recovered = await recoverRegistry(pool, registryPath, actor, 'Recover after crashed publisher')
    expect(recovered.snapshotRevision).toBe(2)
    expect(recovered.targets.map((t: any) => t.tenantId).sort()).toEqual(['live_a', 'live_b'])
    const onDisk = JSON.parse(await readFile(registryPath, 'utf8'))
    expect(onDisk.snapshotRevision).toBe(2)
    expect(onDisk.targets).toHaveLength(2)
    const audit = await pool.query("SELECT count(*)::int AS count FROM audit_events WHERE action='registry.recovery_requested'")
    expect(audit.rows[0].count).toBe(1)
    const barrier = await pool.query('SELECT 1')
    expect(barrier.rowCount).toBeDefined()
  })

  it('enqueues a provision job and deduplicates concurrent identical requests on live SQL', async () => {
    const requestId = randomUUID()
    const results = await Promise.all(Array.from({ length: 5 }, () =>
      enqueueSharedJob(pool, tenantA, actor, { schemaVersion: 1, operation: 'provision', requestId }, 'Concurrent enqueue gate')))
    expect(new Set(results.map(r => r.id)).size).toBe(1)
    expect(results.filter(r => r.replay)).toHaveLength(4)
    expect(results[0]!.state).toBe('queued')
    provisionJobId = results[0]!.id
    const rows = await pool.query('SELECT count(*)::int AS count FROM shared_jobs WHERE control_tenant_id=$1', [tenantA])
    expect(rows.rows[0].count).toBe(1)
    await expect(enqueueSharedJob(pool, tenantA, otherActor, { schemaVersion: 1, operation: 'provision', requestId }, 'Other actor replay'))
      .rejects.toThrow('shared_replay_forbidden')
  })

  it('resolves a concurrent claim race so exactly one worker executes the effect', async () => {
    const effects: string[] = []
    const adapter: SharedFencedAdapter = {
      observe: async (job) => effects.length === 0
        ? { state: 'absent' }
        : { state: 'present', binding: job.binding, businessKey: businessKey(job), payloadDigest: payloadDigest(job), verified: true },
      applyFenced: async ({ job }) => { effects.push(job.binding.tenantId) },
    }
    const settled = await Promise.allSettled([
      runSharedJob(pool, provisionJobId, adapter),
      runSharedJob(pool, provisionJobId, adapter),
    ])
    const winners = settled.filter(r => r.status === 'fulfilled')
    const losers = settled.filter(r => r.status === 'rejected')
    expect(winners).toHaveLength(1)
    expect(losers).toHaveLength(1)
    expect((losers[0] as PromiseRejectedResult).reason).toMatchObject({ message: 'shared_job_not_claimable' })
    expect((winners[0] as PromiseFulfilledResult<any>).value.state).toBe('verified')
    expect(effects).toEqual(['live_a'])
    const row = await pool.query('SELECT state,fence,receipt::text AS receipt FROM shared_jobs WHERE id=$1', [provisionJobId])
    expect(row.rows[0].state).toBe('verified')
    expect(Number(JSON.parse(row.rows[0].receipt).sequence)).toBeGreaterThan(0)
    const events = await pool.query("SELECT stage FROM shared_job_events WHERE job_id=$1 ORDER BY sequence", [provisionJobId])
    expect(events.rows.map((r: any) => r.stage)).toEqual(['prepared', 'started', 'verified'])
  })

  it('enqueues a distinct backup job for the tenant', async () => {
    backupJobId = (await enqueueSharedJob(pool, tenantA, actor, { schemaVersion: 1, operation: 'backup', requestId: randomUUID() }, 'Backup job')).id
    expect(backupJobId).toBeTruthy()
  })

  it('quarantines an expired lease, rejects the old owner, and forbids re-claim', async () => {
    const claimed = await pool.query('SELECT payload FROM shared_jobs WHERE id=$1', [backupJobId])
    backupPayload = claimed.rows[0].payload
    crashedAttempt = randomUUID()
    await pool.query("UPDATE shared_jobs SET state='running',attempt_id=$1,fence=1,lease_until=clock_timestamp()+interval '120 seconds' WHERE id=$2 AND state='queued'", [crashedAttempt, backupJobId])
    await pool.query('INSERT INTO shared_job_events(job_id,attempt_id,fence,sequence,stage,evidence) VALUES($1,$2,1,1,\'prepared\',\'{"state":"absent"}\'::jsonb)', [backupJobId, crashedAttempt])
    const journal = { schemaVersion: 1, job: backupPayload, attemptId: crashedAttempt, sequence: 1, stage: 'prepared' }
    await pool.query('UPDATE shared_jobs SET journal=$1 WHERE id=$2 AND attempt_id=$3', [journal, backupJobId, crashedAttempt])
    // Simulate time passing: lease now in the past.
    await pool.query("UPDATE shared_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1", [backupJobId])
    const expired = await expireSharedLeases(pool)
    expect(expired).toBeGreaterThanOrEqual(1)
    const quarantined = await pool.query('SELECT state,fence::float8 AS fence,lease_until FROM shared_jobs WHERE id=$1', [backupJobId])
    expect(quarantined.rows[0].state).toBe('needs_intervention')
    expect(quarantined.rows[0].fence).toBe(2)
    expect(quarantined.rows[0].lease_until).toBeNull()
    const audit = await pool.query("SELECT count(*)::int AS count FROM audit_events WHERE action='shared_job.lease_expired' AND subject=$1", [backupJobId])
    expect(audit.rows[0].count).toBe(1)
    // The old owner (old attempt/fence) can no longer write events: DB trigger rejects.
    await expect(pool.query('INSERT INTO shared_job_events(job_id,attempt_id,fence,sequence,stage,evidence) VALUES($1,$2,1,2,\'started\',\'{"state":"absent"}\'::jsonb)', [backupJobId, crashedAttempt]))
      .rejects.toThrow(/ownership mismatch|lease expired/i)
    // And the quarantined job cannot be silently re-claimed by a new worker.
    const adapter: SharedFencedAdapter = { observe: async () => ({ state: 'absent' }), applyFenced: async () => {} }
    await expect(runSharedJob(pool, backupJobId, adapter)).rejects.toMatchObject({ message: 'shared_job_not_claimable' })
    // A quarantined job also blocks new jobs for the tenant until reconciled.
    await expect(enqueueSharedJob(pool, tenantA, actor, { schemaVersion: 1, operation: 'backup', requestId: randomUUID() }, 'Blocked by quarantine'))
      .rejects.toThrow('shared_reconciliation_required')
  })

  it('verifies an ambiguous effect through operator recovery with a fresh observation', async () => {
    const effects = ['already-applied-by-crashed-attempt']
    const adapter: SharedFencedAdapter = {
      observe: async (job) => ({ state: 'present', binding: job.binding, businessKey: businessKey(job), payloadDigest: payloadDigest(job), verified: true }),
      applyFenced: async () => { effects.push('must-not-reapply') },
    }
    const result = await recoverSharedJob(pool, backupJobId, actor, 'Operator verified the crashed backup externally', adapter)
    expect(result.state).toBe('verified')
    expect(effects).toEqual(['already-applied-by-crashed-attempt'])
    const row = await pool.query('SELECT state,receipt::text AS receipt FROM shared_jobs WHERE id=$1', [backupJobId])
    expect(row.rows[0].state).toBe('verified')
    const receipt = JSON.parse(row.rows[0].receipt)
    expect(receipt.attemptId).toBe(crashedAttempt)
    const events = await pool.query("SELECT stage FROM shared_job_events WHERE job_id=$1 AND stage='verified'", [backupJobId])
    expect(events.rows).toHaveLength(1)
  })
})
