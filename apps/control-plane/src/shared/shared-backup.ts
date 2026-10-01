// Package-5 backup and restore authority for the shared lane. A backup record
// exists only after a consistent tenant snapshot was captured in one tenant-DB
// transaction AND independently verified by readback (database digest and
// filestore artifact digest). Restore is a separately authorized operator
// decision: an approval references one verified backup and one NEW target
// database, expires, and can be consumed exactly once. Restore never writes
// into a database that the registry already maps to a tenant, and refuses
// non-empty targets — at enqueue (before a job exists) and again at the effect
// stage. This module is the durable authority behind those refusals.
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Pool, PoolClient } from 'pg'
import { z } from 'zod'
import type { SharedJob } from '@nasq/commercial-contracts/shared'
import { transaction } from '../db.js'
import type { TenantStorage } from './fenced-adapter.js'
import { ensureTenantStorageSchema } from './fenced-adapter.js'
import { ensureAdminBindingSchema } from './provision-readiness.js'
import { REGISTRY_ADVISORY_LOCK } from './registry-store.js'

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/** A restore target must not be a database the registry already maps to a
 * tenant (binding database/filestore or host reservation). One definition,
 * used by the approval authority and by the enqueue pre-check. */
export async function assertRestoreTargetUnreserved(client: Pool | PoolClient, targetDatabase: string): Promise<void> {
  const reserved = await client.query(
    `SELECT 1 FROM shared_registry_hosts WHERE host=$1
     UNION ALL
     SELECT 1 FROM shared_registry_bindings WHERE database_name=$1 OR filestore=$1
     LIMIT 1`, [targetDatabase])
  if (reserved.rowCount) throw new Error('restore_target_reserved')
}

/** The target's restore tables must exist before they can be locked or read. */
export async function ensureRestoreTargetSchema(storage: TenantStorage): Promise<void> {
  await ensureTenantStorageSchema(storage)
  await ensureAdminBindingSchema(storage)
}

/** A restore target must be NEW: no fencing, effect or admin row was ever
 * applied to it. One definition, shared by the enqueue pre-check and the effect
 * stage. The runner is the caller's connection, so the effect stage can run it
 * inside the exclusive table lock of the transaction that writes the snapshot. */
export async function assertRestoreTargetEmpty(runner: Pool | PoolClient): Promise<void> {
  const occupied = await runner.query(
    `SELECT (SELECT count(*) FROM shared_fencing)
          + (SELECT count(*) FROM shared_effects)
          + (SELECT count(*) FROM shared_admin)
          + (SELECT count(*) FROM shared_tenant_policy) AS count`)
  if (Number(occupied.rows[0].count) > 0) throw new Error('restore_target_not_empty')
}

/** Connection-class failures mean the target cannot be inspected from here
 * (for example a database that does not exist yet); the effect stage stays the
 * backstop for those, so enqueue does not turn them into a rejection. */
const UNREACHABLE = new Set(['3D000','57P03','08001','08004','08006','ECONNREFUSED','ECONNRESET','ENOTFOUND','ETIMEDOUT','EHOSTUNREACH'])

/** Inspect the approved target through the caller's tenant connector: an
 * absent connector or an unreachable target leaves the decision to the effect
 * stage. */
export async function assertRestoreTargetInspectable(connect: ((database: string) => Promise<TenantStorage>) | undefined, targetDatabase: string): Promise<void> {
  if (!connect) return
  let storage: TenantStorage | undefined
  try {
    storage = await connect(targetDatabase)
    await ensureRestoreTargetSchema(storage)
    await assertRestoreTargetEmpty(storage.pool)
  } catch (error) {
    if (!UNREACHABLE.has((error as { code?: string }).code ?? '')) throw error
    // The original error stays authoritative; closing is best effort.
  } finally { if (storage) { try { await storage.pool.end() } catch { /* already settled */ } } }
}

/** The verified restore is finalized in the caller's transaction. The effect
 * stage normally consumes the approval and writes the completion audit; if its
 * control transaction was lost after the tenant commit (crash between the two
 * commits), the worker's verified receipt consumes the approval here instead,
 * exactly once, and records `shared_restore.completed` once. Idempotent: an
 * approval already consumed by the effect stage is left alone. */
export async function finalizeVerifiedRestore(client: PoolClient, job: SharedJob, actor: { issuer: string; actorUid: number }): Promise<void> {
  if (job.operation !== 'restore') return
  const consumed = await client.query('UPDATE shared_restore_approvals SET consumed_at=clock_timestamp() WHERE id=$1 AND consumed_at IS NULL RETURNING id,target_database', [job.approvalId])
  if (!consumed.rowCount) return
  await client.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)',
    [randomUUID(), `${actor.issuer}:${actor.actorUid}`, 'shared_restore.completed', job.approvalId,
      'Verified restore finalized from the job receipt after the effect stage lost its control transaction',
      { targetDatabase: consumed.rows[0].target_database, jobBinding: job.binding.database }])
}

export type SharedBackupRecord = {
  backupId: string
  databaseSha256: string
  filestoreSha256: string
}

/** Fault-injection / pause seams for the live persistence tests: `beforeWrite`
 * runs inside the tenant write transaction after the exclusive lock and the
 * emptiness check, `beforeReadback` runs inside the same transaction after the
 * snapshot write and before the readback digest (a test can tamper with the
 * written state to force a mismatch), `beforeConsume` runs after the tenant
 * transaction has verified and committed, before the consumption update. All
 * three are absent in production callers. */
export type RestoreHooks = { beforeWrite?: (tenant: PoolClient) => Promise<void>; beforeReadback?: (tenant: PoolClient) => Promise<void>; beforeConsume?: () => Promise<void> }

/** Capture a consistent snapshot and record it only after readback
 * verification. The tenant-DB read happens in one transaction; the artifact
 * file is written next to the control plane's backup root; both digests are
 * recomputed from a fresh read before the insert-only control record. */
export async function createTenantBackup(pool: Pool, connect: (database: string) => Promise<TenantStorage>, input: { controlTenantId: string; backupRoot: string; createdBy: string }): Promise<SharedBackupRecord> {
  z.uuid().parse(input.controlTenantId)
  z.string().trim().min(3).max(1000).parse(input.createdBy)
  const authority = await transaction(pool, async client => {
    const binding = await client.query('SELECT tenant_id,database_name,filestore FROM shared_registry_bindings WHERE control_tenant_id=$1', [input.controlTenantId])
    if (!binding.rowCount) throw new Error('tenant_binding_unavailable')
    const job = await client.query("SELECT state,payload FROM shared_jobs WHERE control_tenant_id=$1 AND business_key=$2 AND state='verified'", [input.controlTenantId, JSON.stringify(['shared-v1', binding.rows[0].tenant_id, 'provision', 'initial'])])
    if (!job.rowCount) throw new Error('provision_not_verified')
    return binding.rows[0]
  })
  const storage = await connect(authority.database_name)
  let snapshot: Record<string, unknown>
  let databaseSha256 = ''
  try {
    await ensureTenantStorageSchema(storage)
    await ensureAdminBindingSchema(storage)
    snapshot = await transaction(storage.pool, async client => {
      const fencing = await client.query('SELECT tenant_id,fence::float8 AS fence FROM shared_fencing ORDER BY tenant_id')
      const effects = await client.query('SELECT tenant_id,business_key,payload_digest,attempt_id::text AS attempt_id,fence::float8 AS fence FROM shared_effects ORDER BY tenant_id,business_key')
      const admin = await client.query('SELECT tenant_id,request_id::text AS request_id,login FROM shared_admin ORDER BY tenant_id')
      const policy = await client.query('SELECT tenant_id,policy_revision::float8 AS policy_revision,features FROM shared_tenant_policy ORDER BY tenant_id')
      return { schemaVersion: 1, tenantId: authority.tenant_id, fencing: fencing.rows, effects: effects.rows, admin: admin.rows, policy: policy.rows }
    })
    databaseSha256 = digest(JSON.stringify(snapshot))
  } finally { await storage.pool.end() }
  const backupId = randomUUID()
  const artifactPath = `${input.backupRoot}/${backupId}.json`
  await mkdir(dirname(artifactPath), { recursive: true })
  const filestoreBytes = JSON.stringify({ schemaVersion: 1, backupId, tenantId: authority.tenant_id, filestore: authority.filestore, marker: `FILESTORE_${authority.tenant_id}` })
  await writeFile(artifactPath, filestoreBytes, { mode: 0o600 })
  // Independent readback verification before any authority is recorded.
  const rereadArtifact = await readFile(artifactPath, 'utf8')
  const filestoreSha256 = digest(rereadArtifact)
  if (rereadArtifact !== filestoreBytes) throw new Error('backup_artifact_unstable')
  const verifyStorage = await connect(authority.database_name)
  try {
    const fencing = await verifyStorage.pool.query('SELECT tenant_id,fence::float8 AS fence FROM shared_fencing ORDER BY tenant_id')
    const effects = await verifyStorage.pool.query('SELECT tenant_id,business_key,payload_digest,attempt_id::text AS attempt_id,fence::float8 AS fence FROM shared_effects ORDER BY tenant_id,business_key')
    const admin = await verifyStorage.pool.query('SELECT tenant_id,request_id::text AS request_id,login FROM shared_admin ORDER BY tenant_id')
    const policy = await verifyStorage.pool.query('SELECT tenant_id,policy_revision::float8 AS policy_revision,features FROM shared_tenant_policy ORDER BY tenant_id')
    const reread = { schemaVersion: 1, tenantId: authority.tenant_id, fencing: fencing.rows, effects: effects.rows, admin: admin.rows, policy: policy.rows }
    if (digest(JSON.stringify(reread)) !== databaseSha256) throw new Error('backup_readback_mismatch')
  } finally { await verifyStorage.pool.end() }
  await transaction(pool, async client => {
    await client.query(`INSERT INTO shared_backups(id,control_tenant_id,tenant_id,database_name,filestore,snapshot,database_sha256,filestore_sha256,artifact_path,consistency,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'verified',$10)`,
      [backupId, input.controlTenantId, authority.tenant_id, authority.database_name, authority.filestore, snapshot, databaseSha256, filestoreSha256, artifactPath, input.createdBy])
    await client.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)',
      [randomUUID(), input.createdBy, 'shared_backup.verified', backupId, 'Consistent snapshot verified by readback', { databaseSha256, filestoreSha256 }])
  })
  return { backupId, databaseSha256, filestoreSha256 }
}

/** Operator approval: one verified backup, one explicit NEW target database,
 * bounded lifetime. Nothing is restored here. */
export async function approveSharedRestore(pool: Pool, input: { backupId: string; controlTenantId: string; targetDatabase: string; ttlSeconds: number; actor: { issuer: string; actorUid: number } }): Promise<{ approvalId: string }> {
  z.uuid().parse(input.backupId)
  z.uuid().parse(input.controlTenantId)
  z.string().regex(/^[a-z][a-z0-9_]{0,62}$/).parse(input.targetDatabase)
  if (!Number.isSafeInteger(input.ttlSeconds) || input.ttlSeconds < 60 || input.ttlSeconds > 86400) throw new Error('approval_ttl_invalid')
  const approvalId = randomUUID()
  await transaction(pool, async client => {
    const grant = await client.query("SELECT 1 FROM vendor_memberships WHERE issuer=$1 AND actor_uid=$2 AND revoked_at IS NULL AND 'vendor.operations.run'=ANY(capabilities) FOR SHARE", [input.actor.issuer, input.actor.actorUid])
    if (!grant.rowCount) throw new Error('shared_restore_forbidden')
    const backup = await client.query("SELECT control_tenant_id FROM shared_backups WHERE id=$1 AND consistency='verified'", [input.backupId])
    if (!backup.rowCount || backup.rows[0].control_tenant_id !== input.controlTenantId) throw new Error('backup_unavailable')
    // The target must not be a live tenant database: registry bindings and
    // reservations make existing databases ineligible for restore targets.
    await assertRestoreTargetUnreserved(client, input.targetDatabase)
    await client.query('INSERT INTO shared_restore_approvals(id,backup_id,control_tenant_id,target_database,reason,expires_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()+($6||\' seconds\')::interval)',
      [approvalId, input.backupId, input.controlTenantId, input.targetDatabase, 'Approved restore to a new isolated target', input.ttlSeconds])
    await client.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)',
      [randomUUID(), `${input.actor.issuer}:${input.actor.actorUid}`, 'shared_restore.approved', approvalId, 'Restore approval granted for a new target', { backupId: input.backupId, targetDatabase: input.targetDatabase }])
  })
  return { approvalId }
}

/** Execute an approved restore into the new target. The target must be
 * unregistered and empty; the snapshot is written under an exclusive tenant
 * table lock and verified by readback INSIDE the same tenant transaction,
 * before COMMIT, so a readback mismatch rolls the target back to empty instead
 * of leaving a partially written tenant behind. The previous design committed
 * the tenant transaction first and read back afterwards; for this synthetic
 * storage reading inside the transaction is equivalent — and strictly safer:
 * the readback observes exactly the written state through the same client that
 * holds the EXCLUSIVE lock (no concurrent writer can interleave between COMMIT
 * and the readback to forge or corrupt the verified state), and a mismatch now
 * rolls back the write instead of failing after the target was mutated.
 *
 * The readback digest is computed over the snapshot's own shape: a backup
 * taken before `shared_tenant_policy` existed stores a snapshot with no
 * `policy` key and a digest over that shape, so the readback omits `policy`
 * for it too. A restored tenant without a policy row then fails the
 * activation gate's `initial_policy` check — fail-closed by design: an
 * operator must grant the policy before the tenant can activate.
 *
 * Everything that can fail without touching the target (the reservation check
 * and the target schema checks) runs before the first tenant write; the digest
 * verification is the in-transaction readback, which rolls back on mismatch
 * (see the comment inside for why the stored snapshot cannot be re-digested).
 * The approval is consumed exactly once, in the same
 * control transaction that holds the registry publication lock, so no binding
 * for the target can be published between the reservation check and the
 * consumption.
 *
 * Lock order (deadlock-free): the registry advisory lock, then control row locks
 * (approval), then tenant table locks. `publishRegistryMutation` takes the same
 * advisory lock first, so the two can never form a cycle; nothing that holds a
 * control row lock ever waits for the advisory lock. */
export async function restoreBackupToNewTarget(pool: Pool, connect: (database: string) => Promise<TenantStorage>, input: { approvalId: string; actor: { issuer: string; actorUid: number }; hooks?: RestoreHooks }): Promise<{ databaseSha256: string; applied: boolean }> {
  z.uuid().parse(input.approvalId)
  const client = await pool.connect()
  let controlHeld = false
  try {
    await client.query('BEGIN')
    controlHeld = true
    // Same advisory lock the registry publisher holds, so a binding for the
    // target cannot be published between the check below and the consumption.
    await client.query('SELECT pg_advisory_xact_lock($1)', [REGISTRY_ADVISORY_LOCK])
    const row = await client.query(`SELECT a.id,a.backup_id,a.control_tenant_id,a.target_database,a.expires_at,b.snapshot,b.database_sha256
      FROM shared_restore_approvals a JOIN shared_backups b ON b.id=a.backup_id
      WHERE a.id=$1 AND a.consumed_at IS NULL AND a.expires_at>clock_timestamp() FOR UPDATE OF a`, [input.approvalId])
    if (!row.rowCount) throw new Error('restore_approval_unavailable')
    const approval = row.rows[0]
    await assertRestoreTargetUnreserved(client, approval.target_database)
    const snapshot = approval.snapshot as { tenantId?: string; fencing: { tenant_id: string; fence: string }[]; effects: { tenant_id: string; business_key: string; payload_digest: string; attempt_id: string; fence: string }[]; admin: { tenant_id: string; request_id: string; login: string }[]; policy?: { tenant_id: string; policy_revision: string | number; features: Record<string, unknown> }[] }
    // Pre-write verification: everything that can fail without touching the
    // target runs before the first tenant write — the reservation check above
    // and the target schema checks below. The snapshot digest itself CANNOT be
    // verified from the stored `snapshot` column here: jsonb does not preserve
    // object key order, so re-serializing the stored value would not reproduce
    // the capture-time digest. Digest verification therefore happens as the
    // in-transaction readback below, where a fresh row read reproduces the
    // capture shape exactly — and where a mismatch now rolls the target back
    // to empty instead of failing after the target was mutated.
    const storage = await connect(approval.target_database)
    let databaseSha256 = ''
    try {
      await ensureRestoreTargetSchema(storage)
      // One tenant transaction: exclusive table lock, emptiness check, the
      // snapshot write and the readback verification are atomic, so no
      // concurrent writer can interleave and a mismatch rolls everything back.
      await transaction(storage.pool, async tenant => {
        await tenant.query('LOCK TABLE shared_fencing, shared_effects, shared_admin, shared_tenant_policy IN EXCLUSIVE MODE')
        await assertRestoreTargetEmpty(tenant)
        await input.hooks?.beforeWrite?.(tenant)
        for (const row of snapshot.fencing) await tenant.query('INSERT INTO shared_fencing(tenant_id,fence) VALUES($1,$2)', [row.tenant_id, row.fence])
        for (const row of snapshot.effects) await tenant.query('INSERT INTO shared_effects(tenant_id,business_key,payload_digest,attempt_id,fence) VALUES($1,$2,$3,$4,$5)', [row.tenant_id, row.business_key, row.payload_digest, row.attempt_id, row.fence])
        for (const row of snapshot.admin) await tenant.query('INSERT INTO shared_admin(tenant_id,request_id,login) VALUES($1,$2,$3)', [row.tenant_id, row.request_id, row.login])
        // A pre-policy backup carries no `policy` key: restore its shape as-is.
        // The restored tenant then stays below the activation gate until an
        // operator grants the policy (initial_policy check).
        if ('policy' in snapshot) for (const row of snapshot.policy ?? []) await tenant.query('INSERT INTO shared_tenant_policy(tenant_id,policy_revision,features) VALUES($1,$2,$3::jsonb)', [row.tenant_id, row.policy_revision, JSON.stringify(row.features)])
        await input.hooks?.beforeReadback?.(tenant)
        // Readback verification of the applied state, still uncommitted: the
        // digest shape mirrors the snapshot's own key shape.
        const fencing = await tenant.query('SELECT tenant_id,fence::float8 AS fence FROM shared_fencing ORDER BY tenant_id')
        const effects = await tenant.query('SELECT tenant_id,business_key,payload_digest,attempt_id::text AS attempt_id,fence::float8 AS fence FROM shared_effects ORDER BY tenant_id,business_key')
        const admin = await tenant.query('SELECT tenant_id,request_id::text AS request_id,login FROM shared_admin ORDER BY tenant_id')
        const applied: Record<string, unknown> = { schemaVersion: 1, tenantId: snapshot.tenantId, fencing: fencing.rows, effects: effects.rows, admin: admin.rows }
        if ('policy' in snapshot) {
          const policy = await tenant.query('SELECT tenant_id,policy_revision::float8 AS policy_revision,features FROM shared_tenant_policy ORDER BY tenant_id')
          applied.policy = policy.rows
        }
        databaseSha256 = digest(JSON.stringify(applied))
        if (databaseSha256 !== approval.database_sha256) throw new Error('restore_readback_mismatch')
      })
    } finally { await storage.pool.end() }
    await input.hooks?.beforeConsume?.()
    const consumed = await client.query('UPDATE shared_restore_approvals SET consumed_at=clock_timestamp() WHERE id=$1 AND consumed_at IS NULL RETURNING id', [input.approvalId])
    if (!consumed.rowCount) throw new Error('restore_approval_unavailable')
    await client.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)',
      [randomUUID(), `${input.actor.issuer}:${input.actor.actorUid}`, 'shared_restore.completed', input.approvalId, 'Verified restore applied to a new target', { targetDatabase: approval.target_database, databaseSha256 }])
    await client.query('COMMIT')
    controlHeld = false
    return { databaseSha256, applied: true }
  } catch (error) {
    if (controlHeld) { try { await client.query('ROLLBACK') } catch { /* original error wins */ } }
    throw error
  } finally { client.release() }
}
