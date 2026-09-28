// Package-5 backup and restore authority for the shared lane. A backup record
// exists only after a consistent tenant snapshot was captured in one tenant-DB
// transaction AND independently verified by readback (database digest and
// filestore artifact digest). Restore is a separately authorized operator
// decision: an approval references one verified backup and one NEW target
// database, expires, and can be consumed exactly once. Restore never writes
// into a database that the registry already maps to a tenant, and refuses
// non-empty targets. The shared job queue keeps refusing restore operations;
// this module is the deliberate authority those guards were waiting for.
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Pool } from 'pg'
import { z } from 'zod'
import { transaction } from '../db.js'
import type { TenantStorage } from './fenced-adapter.js'
import { ensureTenantStorageSchema } from './fenced-adapter.js'
import { ensureAdminBindingSchema } from './provision-readiness.js'

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export type SharedBackupRecord = {
  backupId: string
  databaseSha256: string
  filestoreSha256: string
}

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
      return { schemaVersion: 1, tenantId: authority.tenant_id, fencing: fencing.rows, effects: effects.rows, admin: admin.rows }
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
    const reread = { schemaVersion: 1, tenantId: authority.tenant_id, fencing: fencing.rows, effects: effects.rows, admin: admin.rows }
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
    const reserved = await client.query('SELECT 1 FROM shared_registry_bindings WHERE database_name=$1', [input.targetDatabase])
    if (reserved.rowCount) throw new Error('restore_target_reserved')
    await client.query('INSERT INTO shared_restore_approvals(id,backup_id,control_tenant_id,target_database,reason,expires_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()+($6||\' seconds\')::interval)',
      [approvalId, input.backupId, input.controlTenantId, input.targetDatabase, 'Approved restore to a new isolated target', input.ttlSeconds])
    await client.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)',
      [randomUUID(), `${input.actor.issuer}:${input.actor.actorUid}`, 'shared_restore.approved', approvalId, 'Restore approval granted for a new target', { backupId: input.backupId, targetDatabase: input.targetDatabase }])
  })
  return { approvalId }
}

/** Execute an approved restore into the new target. The approval is consumed
 * exactly once; the target must be empty; the applied snapshot is verified by
 * readback before the consumption is committed. */
export async function restoreBackupToNewTarget(pool: Pool, connect: (database: string) => Promise<TenantStorage>, input: { approvalId: string; actor: { issuer: string; actorUid: number } }): Promise<{ databaseSha256: string; applied: boolean }> {
  z.uuid().parse(input.approvalId)
  const approval = await transaction(pool, async client => {
    const row = await client.query(`SELECT a.id,a.backup_id,a.control_tenant_id,a.target_database,a.expires_at,b.snapshot,b.database_sha256
      FROM shared_restore_approvals a JOIN shared_backups b ON b.id=a.backup_id
      WHERE a.id=$1 AND a.consumed_at IS NULL AND a.expires_at>clock_timestamp() FOR UPDATE OF a`, [input.approvalId])
    if (!row.rowCount) throw new Error('restore_approval_unavailable')
    return row.rows[0]
  })
  const snapshot = approval.snapshot as { fencing: { tenant_id: string; fence: string }[]; effects: { tenant_id: string; business_key: string; payload_digest: string; attempt_id: string; fence: string }[]; admin: { tenant_id: string; request_id: string; login: string }[] }
  const storage = await connect(approval.target_database)
  let databaseSha256 = ''
  try {
    await ensureTenantStorageSchema(storage)
    await ensureAdminBindingSchema(storage)
    const occupied = await storage.pool.query('SELECT count(*)::int AS count FROM shared_effects')
    if (occupied.rows[0].count > 0) throw new Error('restore_target_not_empty')
    await transaction(storage.pool, async client => {
      for (const row of snapshot.fencing) await client.query('INSERT INTO shared_fencing(tenant_id,fence) VALUES($1,$2)', [row.tenant_id, row.fence])
      for (const row of snapshot.effects) await client.query('INSERT INTO shared_effects(tenant_id,business_key,payload_digest,attempt_id,fence) VALUES($1,$2,$3,$4,$5)', [row.tenant_id, row.business_key, row.payload_digest, row.attempt_id, row.fence])
      for (const row of snapshot.admin) await client.query('INSERT INTO shared_admin(tenant_id,request_id,login) VALUES($1,$2,$3)', [row.tenant_id, row.request_id, row.login])
    })
    // Readback verification of the applied state.
    const applied = await transaction(storage.pool, async client => {
      const fencing = await client.query('SELECT tenant_id,fence::float8 AS fence FROM shared_fencing ORDER BY tenant_id')
      const effects = await client.query('SELECT tenant_id,business_key,payload_digest,attempt_id::text AS attempt_id,fence::float8 AS fence FROM shared_effects ORDER BY tenant_id,business_key')
      const admin = await client.query('SELECT tenant_id,request_id::text AS request_id,login FROM shared_admin ORDER BY tenant_id')
      return { schemaVersion: 1, tenantId: (snapshot as unknown as { tenantId: string }).tenantId, fencing: fencing.rows, effects: effects.rows, admin: admin.rows }
    })
    databaseSha256 = digest(JSON.stringify(applied))
  } finally { await storage.pool.end() }
  if (databaseSha256 !== approval.database_sha256) throw new Error('restore_readback_mismatch')
  await transaction(pool, async client => {
    const consumed = await client.query('UPDATE shared_restore_approvals SET consumed_at=clock_timestamp() WHERE id=$1 AND consumed_at IS NULL RETURNING id', [input.approvalId])
    if (!consumed.rowCount) throw new Error('restore_approval_unavailable')
    await client.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)',
      [randomUUID(), `${input.actor.issuer}:${input.actor.actorUid}`, 'shared_restore.completed', input.approvalId, 'Verified restore applied to a new target', { targetDatabase: approval.target_database, databaseSha256 }])
  })
  return { databaseSha256, applied: true }
}
