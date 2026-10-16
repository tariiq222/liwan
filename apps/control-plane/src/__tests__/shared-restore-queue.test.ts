// Live evidence for shared-tenant restore through the job queue: real
// PostgreSQL across the control scratch DB and authorized tenant scratch
// databases. Enqueue refuses an approved target that is already a registered
// tenant database or already carries rows, so a predictable restore never
// becomes a queued job; a target that becomes occupied after enqueue is
// quarantined by the effect stage. An admitted restore executes exactly once
// through the loopback fenced storage adapter (createFencedStorageAdapter,
// NOT the production Docker adapter; its restore branch delegates to
// restoreBackupToNewTarget), and the target ends up carrying only the source
// tenant's data.
//
// Every database index used here (10..19) is used by no other live suite, and
// every database is emptied before use: each live suite TRUNCATEs the same
// control tables, so sharing a tenant database silently cross-contaminates
// runs (a leftover effect row makes a later provision reconcile to
// needs_intervention instead of verified).
// Gated on CONTROL_TEST_DATABASE_URL; never touches odoo19.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { migrate } from '../db.js'
import { publishRegistryMutation, REGISTRY_ADVISORY_LOCK } from '../shared/registry-store.js'
import { enqueueSharedJob } from '../shared/job-store.js'
import { runSharedJob, recoverSharedJob, expireSharedLeases } from '../shared/job-worker.js'
import { createFencedStorageAdapter, ensureTenantStorageSchema, type TenantStorage } from '../shared/fenced-adapter.js'
import { bindJob, payloadDigest } from '../shared/provisioning.js'
import { bootstrapFirstAdmin, ensureAdminBindingSchema } from '../shared/provision-readiness.js'
import { createTenantBackup, approveSharedRestore, restoreBackupToNewTarget } from '../shared/shared-backup.js'
import { ensureTenantDatabases, tenantDatabaseNames } from './live-tenant-databases.js'
import { vendorAccount, replaceRoles } from './helpers/vendor-session.js'
import { vendorActorIssuer } from '../admin-auth/grants.js'

const url = process.env.CONTROL_TEST_DATABASE_URL
// Indexes 0..9 belong to the other live suites (shared-fenced-adapter and
// shared-provision-lifecycle use 0-1, shared-backup-restore 0-6,
// shared-journey 0-9, shared-order-payment 7-8); this file owns 10..25.
const scratchDatabases = url ? tenantDatabaseNames(26, url).slice(10) : []
const sourceDatabase = scratchDatabases[0] ?? ''
const targetDatabase = scratchDatabases[1] ?? ''
const consumedTarget = scratchDatabases[2] ?? ''
const registeredTarget = scratchDatabases[3] ?? ''
const occupiedTarget = scratchDatabases[4] ?? ''
const crashTarget = scratchDatabases[5] ?? ''
const revokedTarget = scratchDatabases[6] ?? ''
const otherTenantDatabase = scratchDatabases[7] ?? ''
const raceTarget = scratchDatabases[8] ?? ''
const crossTenantTarget = scratchDatabases[9] ?? ''
const raceBoundTarget = scratchDatabases[10] ?? ''
const registryRaceTarget = scratchDatabases[11] ?? ''
const concurrentWriteTarget = scratchDatabases[12] ?? ''
const lostAckTarget = scratchDatabases[13] ?? ''
const doubleCallTarget = scratchDatabases[14] ?? ''
// Index 49 is never created here: an unreachable approved target is not
// decided at enqueue.
const unreachableTarget = url ? tenantDatabaseNames(50, url)[49]! : ''
if (url) {
  const parsed = new URL(url)
  if (!['127.0.0.1','localhost','::1'].includes(parsed.hostname) || !/^webvue_control_scratch_[a-z0-9]+$/.test(parsed.pathname.slice(1))) throw new Error('CONTROL_TEST_DATABASE_URL must select a unique loopback webvue_control_scratch database')
}
if (!url) describe.skip('shared restore queue (requires CONTROL_TEST_DATABASE_URL)', () => {})
else describe('shared restore queue', () => {
  const pool = new Pool({ connectionString: url, max: 10 })
  const repositoryRoot = fileURLToPath(new URL('../../../..', import.meta.url))
  const tenantUrl = (database: string) => { const u = new URL(url); u.pathname = `/${database}`; return u.toString() }
  const connect = async (database: string): Promise<TenantStorage> => ({ pool: new Pool({ connectionString: tenantUrl(database), max: 1 }) })
  // The loopback storage adapter: observe() reads the approval's target
  // database against the verified backup digest, applyFenced() delegates to the
  // durable restore authority. This is NOT the production Docker adapter.
  const adapter = createFencedStorageAdapter({ controlPool: pool, connect })
  const issuer = vendorActorIssuer('live-restore-queue')
  const actor = { issuer, actorUid: 7 }
  const tenantId = randomUUID()
  const otherTenantId = randomUUID()
  const registeredTenantId = randomUUID()
  const lateBoundTenantId = randomUUID()
  const registryRaceTenantId = randomUUID()
  const fabricatedTenantId = randomUUID()
  const tenantSlug = 't07'
  const otherTenantSlug = 'tb1'
  const registeredTenantSlug = 'tc1'
  const lateBoundTenantSlug = 'td1'
  const registryRaceTenantSlug = 'te1'
  let root = ''
  let registryPath = ''
  let backupId = ''
  let expiredApproval = ''
  const approvals: Record<'main'|'consumed'|'registered'|'occupied'|'unreachable'|'race'|'raceBound'|'registryRace'|'concurrentWrite'|'doubleCall'|'lostAck'|'crash'|'revoked'|'crossTenant', string> =
    { main: '', consumed: '', registered: '', occupied: '', unreachable: '', race: '', raceBound: '', registryRace: '', concurrentWrite: '', doubleCall: '', lostAck: '', crash: '', revoked: '', crossTenant: '' }

  const tenantState = async (database: string) => {
    const storage = await connect(database)
    try {
      await ensureTenantStorageSchema(storage)
      await ensureAdminBindingSchema(storage)
      const fencing = (await storage.pool.query('SELECT tenant_id,fence::float8 AS fence FROM shared_fencing ORDER BY tenant_id')).rows as { tenant_id: string; fence: number }[]
      const effects = (await storage.pool.query('SELECT tenant_id,business_key,payload_digest,attempt_id::text AS attempt_id,fence::float8 AS fence FROM shared_effects ORDER BY tenant_id,business_key')).rows as { tenant_id: string; business_key: string }[]
      const admin = (await storage.pool.query('SELECT tenant_id,login FROM shared_admin ORDER BY tenant_id')).rows as { tenant_id: string; login: string }[]
      return { fencing, effects, admin }
    } finally { await storage.pool.end() }
  }
  const consumedAt = async (approvalId: string) => ((await pool.query('SELECT consumed_at FROM shared_restore_approvals WHERE id=$1', [approvalId])).rows[0]?.consumed_at ?? null) as Date | null
  const jobState = async (id: string) => ((await pool.query('SELECT state FROM shared_jobs WHERE id=$1', [id])).rows[0]?.state ?? '') as string
  const queuedJobsFor = async (approvalId: string) => (await pool.query("SELECT count(*)::int AS count FROM shared_jobs WHERE payload->>'approvalId'=$1", [approvalId])).rows[0].count as number
  const auditCount = async () => (await pool.query('SELECT count(*)::int AS count FROM audit_events')).rows[0].count as number
  const completedAudits = async (approvalId: string) => (await pool.query("SELECT count(*)::int AS count FROM audit_events WHERE action='shared_restore.completed' AND subject=$1", [approvalId])).rows[0].count as number
  const currentRevision = async () => Number((await pool.query('SELECT revision::float8 AS revision FROM shared_registry_state WHERE singleton=true')).rows[0].revision)
  /** Resolves once `ready` has been signalled, then holds the caller until
   * `release()`: a controlled pause inside a restore in flight. */
  const pauseGate = () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    return { gate, release: () => release() }
  }
  /** Polls pg_locks until some other session is waiting, ungranted, on the
   * given advisory lock key. Deterministic replacement for a sleep: it either
   * observes the wait or fails, never passes by timing luck. */
  const waitForAdvisoryWaiter = async (key: number, timeoutMs = 3000) => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const rows = (await pool.query(
        `SELECT a.pid, a.wait_event_type, a.query FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid
         WHERE l.locktype='advisory' AND NOT l.granted AND l.objid::bigint=$1::bigint AND l.objsubid=1`, [key])).rows as { pid: number; wait_event_type: string; query: string }[]
      if (rows.length) return rows
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    throw new Error(`no session waited on advisory lock ${key} within ${timeoutMs}ms`)
  }
  // The queue is told how to reach tenant databases, so the approved target can
  // be inspected before anything is queued.
  const queueRestore = (approvalId: string) =>
    enqueueSharedJob(pool, tenantId, actor, { schemaVersion: 1, requestId: randomUUID(), operation: 'restore', approvalId }, 'Approved restore via queue', { connect })
  const approve = (target: string) => approveSharedRestore(pool, { backupId, controlTenantId: tenantId, targetDatabase: target, ttlSeconds: 3600, actor })
  /** Another tenant's rows in an approved target: the target is no longer new. */
  const seedForeignRows = async (database: string) => {
    const storage = await connect(database)
    try {
      await ensureTenantStorageSchema(storage)
      await ensureAdminBindingSchema(storage)
      await storage.pool.query("INSERT INTO shared_fencing(tenant_id,fence) VALUES('t99',0) ON CONFLICT DO NOTHING")
      await storage.pool.query('INSERT INTO shared_effects(tenant_id,business_key,payload_digest,attempt_id,fence) VALUES($1,$2,$3,$4,0) ON CONFLICT DO NOTHING',
        ['t99', JSON.stringify(['shared-v1','t99','provision','initial']), 'f'.repeat(64), randomUUID()])
    } finally { await storage.pool.end() }
  }

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'webvue-restore-queue-'))
    registryPath = join(root, 'registry.json')
    await migrate(pool)
    await ensureTenantDatabases(pool, scratchDatabases)
    await pool.query('TRUNCATE shared_job_events, shared_jobs, shared_registry_audit, shared_registry_hosts, shared_registry_bindings, shared_registry_state CASCADE')
    await pool.query('TRUNCATE shared_payment_events, shared_orders, shared_restore_approvals, shared_backups CASCADE')
    await pool.query('TRUNCATE tenants, package_revisions, commercial_packages, catalog_entries CASCADE')
    await pool.query('TRUNCATE vendor_accounts CASCADE')
    await pool.query('TRUNCATE service_nonces, audit_events, operation_events, operations, restore_approvals')
    await pool.query('INSERT INTO shared_registry_state(singleton,revision) VALUES(true,0)')
    await vendorAccount(pool, ['customer_success', 'operations'], 7)
    await pool.query(`INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,catalog_version,catalog_tier,operations_enabled)
      VALUES ($1,$2,'saas','managed',$3,'live-v1','core',true),($4,$5,'saas','managed',$6,'live-v1','core',true),
             ($7,$8,'saas','managed',$9,'live-v1','core',true),($10,$11,'saas','managed',$12,'live-v1','core',true),
             ($13,$14,'saas','managed',$15,'live-v1','core',true)`,
      [tenantId, 'Restore source', 'restore-source', otherTenantId, 'Restore other tenant', 'restore-other',
       registeredTenantId, 'Registered target owner', 'registered-target', lateBoundTenantId, 'Late binding owner', 'late-binding',
       registryRaceTenantId, 'Registry race owner', 'registry-race'])
    const source = await readFile(join(repositoryRoot, 'deploy/catalog/solutions/platform.json'))
    await pool.query('INSERT INTO catalog_entries(id,version,status,solution,source_sha256,published_at) VALUES($1,\'live-v1\',\'published\',$2,$3,now())',
      [randomUUID(), JSON.parse(source.toString('utf8')), createHash('sha256').update(source).digest('hex')])
    // Every scratch database this suite owns is emptied before use, exactly as
    // shared-backup-restore does for its own source and target.
    for (const database of scratchDatabases) {
      const storage = await connect(database)
      try {
        await ensureTenantStorageSchema(storage)
        await ensureAdminBindingSchema(storage)
        await storage.pool.query('TRUNCATE shared_fencing, shared_effects, shared_admin, shared_tenant_policy')
      } finally { await storage.pool.end() }
    }
    await publishRegistryMutation(pool, registryPath, actor, { controlTenantId: tenantId, expectedSnapshotRevision: 0, target: { host: 't07.restore.invalid', tenantId: tenantSlug, database: sourceDatabase, filestore: sourceDatabase, enabled: true, registryRevision: 1 }, reason: 'Restore source tenant' })
    // A second fully registered, operations-enabled tenant: enrolled tenant row,
    // enabled registry binding and a verified provision of its own.
    await publishRegistryMutation(pool, registryPath, actor, { controlTenantId: otherTenantId, expectedSnapshotRevision: 1, target: { host: 'tb1.restore.invalid', tenantId: otherTenantSlug, database: otherTenantDatabase, filestore: otherTenantDatabase, enabled: true, registryRevision: 1 }, reason: 'Restore other tenant' })
    const requestId = randomUUID()
    const job = await enqueueSharedJob(pool, tenantId, actor, { schemaVersion: 1, operation: 'provision', requestId }, 'Restore source provision')
    const result = await runSharedJob(pool, job.id, adapter)
    if (result.state !== 'verified') throw new Error(`provision not verified: ${result.state}`)
    const stored = (await pool.query('SELECT payload FROM shared_jobs WHERE id=$1', [job.id])).rows[0].payload
    const sourceStorage = await connect(sourceDatabase)
    try { await bootstrapFirstAdmin(sourceStorage, { tenantId: tenantSlug, requestId, login: 'admin.t07', expectedEffectDigest: payloadDigest(bindJob(stored)) }) } finally { await sourceStorage.pool.end() }
    const otherProvision = await enqueueSharedJob(pool, otherTenantId, actor, { schemaVersion: 1, operation: 'provision', requestId: randomUUID() }, 'Other tenant provision')
    const otherProvisioned = await runSharedJob(pool, otherProvision.id, adapter)
    if (otherProvisioned.state !== 'verified') throw new Error(`other provision not verified: ${otherProvisioned.state}`)
    const backup = await createTenantBackup(pool, connect, { controlTenantId: tenantId, backupRoot: join(root, 'backups'), createdBy: `${issuer}:7` })
    backupId = backup.backupId
    const otherBackup = await createTenantBackup(pool, connect, { controlTenantId: otherTenantId, backupRoot: join(root, 'backups'), createdBy: `${issuer}:7` })
    // Granted while every target is still a free database: `registered` names the
    // database the third tenant is bound to immediately afterwards, which is what
    // the enqueue pre-check must catch.
    for (const [name, target] of Object.entries({ main: targetDatabase, consumed: consumedTarget, registered: registeredTarget, occupied: occupiedTarget, unreachable: unreachableTarget, race: raceTarget, registryRace: registryRaceTarget, concurrentWrite: concurrentWriteTarget, doubleCall: doubleCallTarget, crash: crashTarget, revoked: revokedTarget, crossTenant: crossTenantTarget })) {
      approvals[name as keyof typeof approvals] = (await approve(target)).approvalId
    }
    // The third tenant: fully registered, bound to the `registered` approval's
    // target and provisioned, so a restore refusal cannot be blamed on an
    // incomplete tenant. Its own backup feeds the lost-acknowledgement test.
    await publishRegistryMutation(pool, registryPath, actor, { controlTenantId: registeredTenantId, expectedSnapshotRevision: 2, target: { host: 'tc1.restore.invalid', tenantId: registeredTenantSlug, database: registeredTarget, filestore: registeredTarget, enabled: true, registryRevision: 1 }, reason: 'Registered target owner' })
    const registeredProvision = await enqueueSharedJob(pool, registeredTenantId, actor, { schemaVersion: 1, operation: 'provision', requestId: randomUUID() }, 'Registered target owner provision')
    const registeredProvisioned = await runSharedJob(pool, registeredProvision.id, adapter)
    if (registeredProvisioned.state !== 'verified') throw new Error(`registered provision not verified: ${registeredProvisioned.state}`)
    const registeredBackup = await createTenantBackup(pool, connect, { controlTenantId: registeredTenantId, backupRoot: join(root, 'backups'), createdBy: `${issuer}:7` })
    // The second and third tenants' own approvals, for the races they own.
    approvals.raceBound = (await approveSharedRestore(pool, { backupId: otherBackup.backupId, controlTenantId: otherTenantId, targetDatabase: raceBoundTarget, ttlSeconds: 3600, actor })).approvalId
    approvals.lostAck = (await approveSharedRestore(pool, { backupId: registeredBackup.backupId, controlTenantId: registeredTenantId, targetDatabase: lostAckTarget, ttlSeconds: 3600, actor })).approvalId
    expiredApproval = randomUUID()
    await pool.query('INSERT INTO shared_restore_approvals(id,backup_id,control_tenant_id,target_database,reason,expires_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()-interval \'1 second\')',
      [expiredApproval, backupId, tenantId, targetDatabase, 'Expired fixture approval'])
  })
  afterAll(async () => { await pool.end(); await rm(root, { recursive: true, force: true }) })

  it('rejects a cross-tenant approval before queueing', async () => {
    // Cross-tenant restore is rejected before reaching the approval lookup:
    // the tenant must exist and have matching operations, so a fabricated
    // tenant id fails with tenant_operations_unavailable.
    await expect(enqueueSharedJob(pool, fabricatedTenantId, actor, { schemaVersion: 1, requestId: randomUUID(), operation: 'restore', approvalId: approvals.main }, 'Cross tenant')).rejects.toThrow('tenant_operations_unavailable')
  })
  it('refuses a restore enqueue without a live vendor operations grant', async () => {
    await replaceRoles(pool, 7, ['support'])
    try {
      await expect(enqueueSharedJob(pool, tenantId, actor, { schemaVersion: 1, requestId: randomUUID(), operation: 'restore', approvalId: approvals.main }, 'Revoked grant')).rejects.toThrow('shared_job_forbidden')
    } finally {
      await replaceRoles(pool, 7, ['customer_success', 'operations'])
    }
  })
  it('rejects an approval that belongs to another fully registered tenant', async () => {
    // The second tenant is fully registered and operations-enabled and has its
    // own verified provision, so the rejection cannot come from the tenancy
    // gate: it is the approval-ownership check itself.
    const before = (await pool.query('SELECT count(*)::int AS count FROM shared_jobs WHERE control_tenant_id=$1', [otherTenantId])).rows[0].count
    await expect(enqueueSharedJob(pool, otherTenantId, actor, { schemaVersion: 1, requestId: randomUUID(), operation: 'restore', approvalId: approvals.crossTenant }, 'Foreign approval'))
      .rejects.toThrow('shared_restore_approval_unavailable')
    expect((await pool.query('SELECT count(*)::int AS count FROM shared_jobs WHERE control_tenant_id=$1', [otherTenantId])).rows[0].count).toBe(before)
    expect(await consumedAt(approvals.crossTenant)).toBeNull()
  })
  it('refuses to execute a queued restore after its grant is revoked', async () => {
    const queued = await queueRestore(approvals.revoked)
    expect(await jobState(queued.id)).toBe('queued')
    await replaceRoles(pool, 7, ['support'])
    try {
      await expect(runSharedJob(pool, queued.id, adapter)).rejects.toThrow('shared_job_forbidden')
    } finally {
      await replaceRoles(pool, 7, ['customer_success', 'operations'])
    }
    // The worker refused before the effect: no consumption, nothing applied.
    expect(await jobState(queued.id)).toBe('queued')
    expect(await consumedAt(approvals.revoked)).toBeNull()
    expect((await tenantState(revokedTarget)).effects).toHaveLength(0)
  })
  it('runs an approved restore once through the loopback fenced storage adapter, leaving only source-tenant data', async () => {
    const queued = await queueRestore(approvals.main)
    const result = await runSharedJob(pool, queued.id, adapter)
    expect(result.state).toBe('verified')
    const consumedFirst = await consumedAt(approvals.main)
    expect(consumedFirst).not.toBeNull()
    // Double dispatch cannot consume the approval a second time or re-apply it.
    await expect(runSharedJob(pool, queued.id, adapter)).rejects.toThrow('shared_job_not_claimable')
    expect(await consumedAt(approvals.main)).toEqual(consumedFirst)
    const state = await tenantState(targetDatabase)
    const tenantIds = [...new Set([...state.fencing, ...state.effects, ...state.admin].map((row) => row.tenant_id))]
    expect(tenantIds).toEqual([tenantSlug])
    expect(state.effects.length).toBeGreaterThan(0)
    expect(state.admin.map((row) => row.login)).toEqual(['admin.t07'])
    // The second, independently provisioned tenant's data never reaches the target.
    const other = await tenantState(otherTenantDatabase)
    expect(other.effects.map((row) => row.tenant_id)).toEqual([otherTenantSlug])
  })
  it('refuses an already consumed approval at enqueue', async () => {
    const queued = await queueRestore(approvals.consumed)
    expect((await runSharedJob(pool, queued.id, adapter)).state).toBe('verified')
    expect(await consumedAt(approvals.consumed)).not.toBeNull()
    await expect(queueRestore(approvals.consumed)).rejects.toThrow('shared_restore_approval_unavailable')
  })
  it('refuses an expired approval at enqueue', async () => {
    await expect(queueRestore(expiredApproval)).rejects.toThrow('shared_restore_approval_unavailable')
  })
  it('recovers a crashed restore by readback without a second consumption or re-execution', async () => {
    const queued = await queueRestore(approvals.crash)
    const stored = (await pool.query('SELECT payload,fence FROM shared_jobs WHERE id=$1', [queued.id])).rows[0]
    const job = bindJob(stored.payload)
    const attemptId = randomUUID()
    const fence = Number(stored.fence) + 1
    // Simulate a worker that persisted 'started', applied the effect through the
    // real adapter, and then died before recording 'verified'.
    await pool.query("UPDATE shared_jobs SET state='running',attempt_id=$2,fence=$3,lease_until=clock_timestamp()+interval '120 seconds',journal=$4 WHERE id=$1",
      [queued.id, attemptId, fence, { schemaVersion: 1, job, attemptId, sequence: 2, stage: 'started' }])
    await adapter.applyFenced({ job, attemptId, fence, assertOwned: async () => {} })
    const consumedFirst = await consumedAt(approvals.crash)
    expect(consumedFirst).not.toBeNull()
    const applied = await tenantState(crashTarget)
    expect(applied.effects.length).toBeGreaterThan(0)
    // The crash leaves a 'running' job whose lease expires and is quarantined.
    await pool.query("UPDATE shared_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1", [queued.id])
    expect(await expireSharedLeases(pool)).toBeGreaterThan(0)
    expect(await jobState(queued.id)).toBe('needs_intervention')
    const recovered = await recoverSharedJob(pool, queued.id, actor, 'Recover a crashed restore by readback', adapter)
    expect(recovered.state).toBe('verified')
    // Recovery reconciled the existing effect: no second consumption, no re-execution.
    expect(await consumedAt(approvals.crash)).toEqual(consumedFirst)
    const after = await tenantState(crashTarget)
    expect(after.effects).toEqual(applied.effects)
    expect(after.fencing).toEqual(applied.fencing)
    await expect(restoreBackupToNewTarget(pool, connect, { approvalId: approvals.crash, actor })).rejects.toThrow('restore_approval_unavailable')
  })
  it('rejects at enqueue a target registered to another tenant after approval', async () => {
    const audits = await auditCount()
    // The approved target became a registered tenant database after approval.
    await expect(queueRestore(approvals.registered)).rejects.toThrow('restore_target_reserved')
    // A predictable rejection leaves no job, no consumption and no audit row.
    expect(await queuedJobsFor(approvals.registered)).toBe(0)
    expect(await consumedAt(approvals.registered)).toBeNull()
    expect(await auditCount()).toBe(audits)
  })
  it('rejects at enqueue a target that already carries rows', async () => {
    const audits = await auditCount()
    await seedForeignRows(occupiedTarget)
    await expect(queueRestore(approvals.occupied)).rejects.toThrow('restore_target_not_empty')
    expect(await queuedJobsFor(approvals.occupied)).toBe(0)
    expect(await consumedAt(approvals.occupied)).toBeNull()
    expect(await auditCount()).toBe(audits)
  })
  it('queues a restore whose approved target is not reachable yet; the effect stage decides', async () => {
    // The target database was never created. Reachability is not a decision
    // this boundary can make, so the queued job is left to the effect stage,
    // which fails closed rather than applying anything.
    const queued = await queueRestore(approvals.unreachable)
    expect(await jobState(queued.id)).toBe('queued')
    expect(await consumedAt(approvals.unreachable)).toBeNull()
  })
  it('serializes a registry binding published while a restore is in flight', async () => {
    const approvalId = approvals.registryRace
    const reached = pauseGate(), gate = pauseGate()
    // Paused before any write to the target, while the restore holds both the
    // registry advisory lock and the tenant exclusive lock.
    const restoring = restoreBackupToNewTarget(pool, connect, { approvalId, actor, hooks: { beforeWrite: async () => { reached.release(); await gate.gate } } })
    await reached.gate
    let publicationDone = false
    const publication = publishRegistryMutation(pool, registryPath, actor, { controlTenantId: registryRaceTenantId, expectedSnapshotRevision: await currentRevision(), target: { host: 'te1.restore.invalid', tenantId: registryRaceTenantSlug, database: registryRaceTarget, filestore: registryRaceTarget, enabled: true, registryRevision: 1 }, reason: 'Binding published during an in-flight restore' })
      .then((result) => { publicationDone = true; return result })
    // Deterministic evidence the publication is blocked: its session is waiting
    // on the registry advisory lock the restore holds, not merely slow.
    const waiting = await waitForAdvisoryWaiter(REGISTRY_ADVISORY_LOCK)
    expect(waiting.map((row) => row.query)).toEqual([expect.stringContaining('pg_advisory_lock')])
    expect(publicationDone).toBe(false)
    gate.release()
    const restored = await restoring
    expect(restored.applied).toBe(true)
    expect(await consumedAt(approvalId)).not.toBeNull()
    // Only after the restore committed could the publication proceed.
    await publication
    expect(publicationDone).toBe(true)
    // The snapshot landed in a still-free target, carrying only source data.
    const state = await tenantState(registryRaceTarget)
    expect([...new Set(state.effects.map((row) => row.tenant_id))]).toEqual([tenantSlug])
    expect(await completedAudits(approvalId)).toBe(1)
  })
  it('blocks a concurrent target writer until the restore commits, with no mixed state', async () => {
    const approvalId = approvals.concurrentWrite
    const reached = pauseGate(), gate = pauseGate()
    const restoring = restoreBackupToNewTarget(pool, connect, { approvalId, actor, hooks: { beforeWrite: async () => { reached.release(); await gate.gate } } })
    await reached.gate
    const writer = await connect(concurrentWriteTarget)
    try {
      await writer.pool.query("SET lock_timeout='300ms'")
      // The restore holds the exclusive tenant table lock, so a writer cannot
      // interleave between the emptiness check and the snapshot insert.
      await expect(writer.pool.query('INSERT INTO shared_effects(tenant_id,business_key,payload_digest,attempt_id,fence) VALUES($1,$2,$3,$4,0)',
        ['t99', JSON.stringify(['shared-v1','t99','provision','initial']), 'f'.repeat(64), randomUUID()])).rejects.toThrow(/lock timeout/i)
    } finally { await writer.pool.end() }
    gate.release()
    expect((await restoring).applied).toBe(true)
    const state = await tenantState(concurrentWriteTarget)
    expect([...new Set(state.effects.map((row) => row.tenant_id))]).toEqual([tenantSlug])
    expect(await consumedAt(approvalId)).not.toBeNull()
  })
  it('applies one effect when two jobs and two calls race on one approval', async () => {
    const approvalId = approvals.doubleCall
    const first = await queueRestore(approvalId)
    // A second job for the same approval is refused while the first is queued.
    await expect(queueRestore(approvalId)).rejects.toThrow('shared_restore_approval_unavailable')
    expect(await queuedJobsFor(approvalId)).toBe(1)
    const outcomes = await Promise.allSettled([
      restoreBackupToNewTarget(pool, connect, { approvalId, actor }),
      restoreBackupToNewTarget(pool, connect, { approvalId, actor }),
    ])
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    const rejected = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected')
    expect(rejected).toHaveLength(1)
    expect(String(rejected[0]!.reason)).toContain('restore_approval_unavailable')
    const state = await tenantState(doubleCallTarget)
    expect([...new Set(state.effects.map((row) => row.tenant_id))]).toEqual([tenantSlug])
    expect(await consumedAt(approvalId)).not.toBeNull()
    expect(await completedAudits(approvalId)).toBe(1)
    expect(await jobState(first.id)).toBe('queued')
  })
  it('refuses at the effect stage a target bound to another tenant after enqueue', async () => {
    // The approval belongs to the second tenant; its target is free at enqueue.
    const queued = await enqueueSharedJob(pool, otherTenantId, actor, { schemaVersion: 1, requestId: randomUUID(), operation: 'restore', approvalId: approvals.raceBound }, 'Late-bound target restore', { connect })
    expect(await jobState(queued.id)).toBe('queued')
    // A third tenant is bound to that same database before the effect runs.
    const revision = Number((await pool.query('SELECT revision::float8 AS revision FROM shared_registry_state WHERE singleton=true')).rows[0].revision)
    await publishRegistryMutation(pool, registryPath, actor, { controlTenantId: lateBoundTenantId, expectedSnapshotRevision: revision, target: { host: 'td1.restore.invalid', tenantId: lateBoundTenantSlug, database: raceBoundTarget, filestore: raceBoundTarget, enabled: true, registryRevision: 1 }, reason: 'Late binding on an approved target' })
    // The durable authority re-checks under the consumption lock, before any
    // write: the snapshot must not land in a database another tenant now owns.
    await expect(runSharedJob(pool, queued.id, adapter)).rejects.toThrow('restore_target_reserved')
    expect(await jobState(queued.id)).toBe('needs_intervention')
    expect(await consumedAt(approvals.raceBound)).toBeNull()
    const state = await tenantState(raceBoundTarget)
    expect([...state.fencing, ...state.effects, ...state.admin]).toEqual([])
    // The same refusal through the authority primitive, still unconsumed.
    await expect(restoreBackupToNewTarget(pool, connect, { approvalId: approvals.raceBound, actor })).rejects.toThrow('restore_target_reserved')
    expect(await consumedAt(approvals.raceBound)).toBeNull()
  })
  it('quarantines a restore whose target becomes non-empty after enqueue', async () => {
    // Empty at enqueue (so the pre-check admits it), occupied before the effect.
    const queued = await queueRestore(approvals.race)
    expect(await jobState(queued.id)).toBe('queued')
    await seedForeignRows(raceTarget)
    await expect(runSharedJob(pool, queued.id, adapter)).rejects.toThrow('effect_identity_mismatch')
    expect(await jobState(queued.id)).toBe('needs_intervention')
    expect(await consumedAt(approvals.race)).toBeNull()
    const state = await tenantState(raceTarget)
    expect(state.effects.map((row) => row.tenant_id)).toEqual(['t99'])
    // The durable authority itself refuses a non-empty target with its own code.
    await expect(restoreBackupToNewTarget(pool, connect, { approvalId: approvals.race, actor })).rejects.toThrow('restore_target_not_empty')
  })
  it('finalizes a restore whose control acknowledgement was lost after the tenant commit', async () => {
    const approvalId = approvals.lostAck
    const queued = await enqueueSharedJob(pool, registeredTenantId, actor, { schemaVersion: 1, requestId: randomUUID(), operation: 'restore', approvalId }, 'Lost-acknowledgement restore', { connect })
    const stored = (await pool.query('SELECT payload,fence FROM shared_jobs WHERE id=$1', [queued.id])).rows[0]
    const job = bindJob(stored.payload)
    const attemptId = randomUUID()
    // The worker persisted 'started' and applied the effect; its control
    // transaction was then lost before the consumption committed.
    await pool.query("UPDATE shared_jobs SET state='running',attempt_id=$2,fence=$3,lease_until=clock_timestamp()+interval '120 seconds',journal=$4 WHERE id=$1",
      [queued.id, attemptId, Number(stored.fence) + 1, { schemaVersion: 1, job, attemptId, sequence: 2, stage: 'started' }])
    await expect(restoreBackupToNewTarget(pool, connect, { approvalId, actor, hooks: { beforeConsume: async () => { throw new Error('simulated_control_ack_loss') } } }))
      .rejects.toThrow('simulated_control_ack_loss')
    // The tenant snapshot is committed while the approval is still unconsumed
    // and no completion audit exists: the lost-acknowledgement state.
    expect((await tenantState(lostAckTarget)).effects.map((row) => row.tenant_id)).toEqual([registeredTenantSlug])
    expect(await consumedAt(approvalId)).toBeNull()
    expect(await completedAudits(approvalId)).toBe(0)
    await pool.query("UPDATE shared_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1", [queued.id])
    expect(await expireSharedLeases(pool)).toBeGreaterThan(0)
    expect(await jobState(queued.id)).toBe('needs_intervention')
    // A quarantined restore job also holds its approval: no second job.
    await expect(enqueueSharedJob(pool, registeredTenantId, actor, { schemaVersion: 1, requestId: randomUUID(), operation: 'restore', approvalId }, 'Second job for a quarantined approval', { connect }))
      .rejects.toThrow('shared_reconciliation_required')
    // Recovery reconciles the committed effect from the receipt: it consumes the
    // approval and records the completion audit exactly once.
    const recovered = await recoverSharedJob(pool, queued.id, actor, 'Recover a lost restore acknowledgement', adapter)
    expect(recovered.state).toBe('verified')
    expect(await consumedAt(approvalId)).not.toBeNull()
    expect(await completedAudits(approvalId)).toBe(1)
    expect((await tenantState(lostAckTarget)).effects.map((row) => row.tenant_id)).toEqual([registeredTenantSlug])
    // A second recovery cannot double-consume or double-audit.
    await expect(recoverSharedJob(pool, queued.id, actor, 'Recover again', adapter)).rejects.toThrow('shared_job_not_recoverable')
    expect(await completedAudits(approvalId)).toBe(1)
    // The consumed approval cannot be reused by a new job.
    await expect(enqueueSharedJob(pool, registeredTenantId, actor, { schemaVersion: 1, requestId: randomUUID(), operation: 'restore', approvalId }, 'Reuse a finalized approval', { connect }))
      .rejects.toThrow('shared_restore_approval_unavailable')
  })
})
