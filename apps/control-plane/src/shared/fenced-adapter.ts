// Physically fenced shared adapter. The fencing guarantee lives at the storage
// boundary, NOT in the worker's callback: applyFenced takes an exclusive row
// lock on the authoritative shared_jobs row (control database) and re-verifies
// attempt/fence/state/lease inside that lock while writing the effect to the
// tenant database. A lease expiry must block on the same row lock, so an
// effect can never commit after ownership loss is recorded; a stale worker
// arriving after expiry/fencing is rejected by the authority store itself even
// if its assertOwned callback lies. Tenant databases additionally keep a
// per-tenant monotonic fence row and an idempotent effect row keyed by
// business key + payload digest.
//
// This is the reference/test adapter for the shared acceptance environment
// (scratch loopback databases). It is NOT the production Docker adapter and
// its selection is always explicit.
import { Pool } from 'pg'
import { createHash } from 'node:crypto'
import type { SharedJob } from '@webvue/commercial-contracts/shared'
import { businessKey, payloadDigest } from './provisioning.js'
import type { SharedFencedAdapter } from './job-worker.js'
import { restoreBackupToNewTarget } from './shared-backup.js'
import { ensureAdminBindingSchema } from './provision-readiness.js'

export class StaleFenceError extends Error {
  constructor(public code: string) { super(code) }
}

export type TenantStorage = { pool: Pool }

export type FencedStorageAdapterOptions = {
  controlPool: Pool
  /** Resolve a tenant database connection from the immutable job binding. */
  connect: (database: string) => Promise<TenantStorage>
  /** Test seam: skip the control-authority recheck to expose the tenant-side barrier alone. */
  trustWorkerClaim?: boolean
}

/** Key-order-independent canonical form so jsonb readback compares exactly. */
function canonicalFeatures(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalFeatures).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map(k => `${JSON.stringify(k)}:${canonicalFeatures(record[k])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/** The initial policy revision a verified provision effect writes. */
export const INITIAL_POLICY_REVISION = 1

export async function ensureTenantStorageSchema(storage: TenantStorage): Promise<void> {
  await storage.pool.query(`CREATE TABLE IF NOT EXISTS shared_fencing (
    tenant_id text PRIMARY KEY,
    fence bigint NOT NULL DEFAULT 0 CHECK (fence >= 0)
  )`)
  await storage.pool.query(`CREATE TABLE IF NOT EXISTS shared_effects (
    tenant_id text NOT NULL,
    business_key text NOT NULL,
    payload_digest text NOT NULL CHECK (payload_digest ~ '^[a-f0-9]{64}$'),
    attempt_id uuid NOT NULL,
    fence bigint NOT NULL CHECK (fence >= 0),
    applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (tenant_id, business_key)
  )`)
  // Initial tenant feature policy, written ONLY by the verified provision
  // effect from the job payload's server-side catalog policy (never from a
  // caller). The activation gate refuses a tenant without revision >= 1 and
  // non-empty features, so a fresh tenant cannot be active before policy.
  await storage.pool.query(`CREATE TABLE IF NOT EXISTS shared_tenant_policy (
    tenant_id text PRIMARY KEY,
    policy_revision bigint NOT NULL CHECK (policy_revision >= 0),
    features jsonb NOT NULL DEFAULT '{}'::jsonb,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
  )`)
}

/** Restore observation truth: the approval's target database is compared
 * against the verified backup digest. An empty target is absent; an exact
 * digest match is present; any other non-empty state is foreign data and must
 * quarantine the job (surface as effect_identity_mismatch). */
async function observeRestore(control: Pool, connect: FencedStorageAdapterOptions['connect'], job: SharedJob) {
  if (job.operation !== 'restore') throw new Error('unexpected_job')
  const approval = await control.query(
    `SELECT a.target_database,b.database_sha256,b.snapshot FROM shared_restore_approvals a
     JOIN shared_backups b ON b.id=a.backup_id WHERE a.id=$1`, [job.approvalId])
  if (!approval.rowCount) return { state: 'absent' as const }
  const row = approval.rows[0]
  const storage = await connect(row.target_database)
  try {
    await ensureTenantStorageSchema(storage)
    await ensureAdminBindingSchema(storage)
    const fencing = await storage.pool.query('SELECT tenant_id,fence::float8 AS fence FROM shared_fencing ORDER BY tenant_id')
    const effects = await storage.pool.query('SELECT tenant_id,business_key,payload_digest,attempt_id::text AS attempt_id,fence::float8 AS fence FROM shared_effects ORDER BY tenant_id,business_key')
    const admin = await storage.pool.query('SELECT tenant_id,request_id::text AS request_id,login FROM shared_admin ORDER BY tenant_id')
    const policy = await storage.pool.query('SELECT tenant_id,policy_revision::float8 AS policy_revision,features FROM shared_tenant_policy ORDER BY tenant_id')
    if (!fencing.rowCount && !effects.rowCount && !admin.rowCount && !policy.rowCount) return { state: 'absent' as const }
    // Same readback shape and digest as restoreBackupToNewTarget: the digest
    // mirrors the stored snapshot's own key shape, so a pre-policy backup
    // (snapshot without a `policy` key) is compared without a policy key.
    const applied: Record<string, unknown> = { schemaVersion: 1, tenantId: row.snapshot?.tenantId ?? null, fencing: fencing.rows, effects: effects.rows, admin: admin.rows }
    if (row.snapshot && typeof row.snapshot === 'object' && 'policy' in row.snapshot) applied.policy = policy.rows
    const appliedDigest = createHash('sha256').update(JSON.stringify(applied)).digest('hex')
    if (appliedDigest === row.database_sha256) {
      return { state: 'present' as const, binding: job.binding, businessKey: businessKey(job), payloadDigest: payloadDigest(job), verified: true }
    }
    // Foreign data in the target: present with a foreign identity so the
    // reconciliation quarantines the job instead of verifying or overwriting.
    return { state: 'present' as const, binding: job.binding, businessKey: 'foreign', payloadDigest: '0'.repeat(64), verified: false }
  } finally { await storage.pool.end() }
}

export function createFencedStorageAdapter(options: FencedStorageAdapterOptions): SharedFencedAdapter {
  const control = options.controlPool
  return {
    async observe(job: SharedJob) {
      if (job.operation === 'restore') return observeRestore(control, options.connect, job)
      const key = businessKey(job)
      const storage = await options.connect(job.binding.database)
      try {
        const rows = await storage.pool.query(
          'SELECT business_key, payload_digest FROM shared_effects WHERE tenant_id=$1 AND business_key=$2',
          [job.binding.tenantId, key])
        if (!rows.rowCount) return { state: 'absent' }
        const row = rows.rows[0]
        // A provision is verified when the initial policy exists (revision
        // >= 1). The provision effect's identity is "the initial policy was
        // written", so the features are compared against the payload's
        // server-side catalog policy only at the initial revision; a higher
        // revision means provisioned-then-updated and stays verified.
        let verified = true
        if (job.operation === 'provision') {
          const policy = await storage.pool.query('SELECT policy_revision::float8 AS revision, features FROM shared_tenant_policy WHERE tenant_id=$1', [job.binding.tenantId])
          const revision = policy.rowCount === 1 ? Number(policy.rows[0].revision) : 0
          verified = revision >= INITIAL_POLICY_REVISION &&
            (revision === INITIAL_POLICY_REVISION ? canonicalFeatures(policy.rows[0].features) === canonicalFeatures(job.policy.features) : true)
        }
        // Observed truth, never the caller's assertion: a foreign digest here
        // surfaces as effect_identity_mismatch and quarantines the job.
        return { state: 'present', binding: job.binding, businessKey: row.business_key, payloadDigest: row.payload_digest, verified }
      } finally { await storage.pool.end() }
    },
    async applyFenced({ job, attemptId, fence, assertOwned }) {
      if (job.operation === 'restore') {
        // Restore delegates the effect to the durable authority
        // (restoreBackupToNewTarget), which consumes the approval exactly once
        // and verifies the applied snapshot by readback. The job-row lock below
        // keeps lease expiry from interleaving with the effect.
        await assertOwned()
        const key = businessKey(job)
        const client = await control.connect()
        let controlHeld = false
        try {
          await client.query('BEGIN')
          controlHeld = true
          const bindingRow = await client.query(
            'SELECT control_tenant_id FROM shared_registry_bindings WHERE tenant_id=$1',
            [job.binding.tenantId])
          if (!bindingRow.rowCount) throw new StaleFenceError('binding_unavailable')
          const authority = await client.query(
            `SELECT issuer,actor_uid,state,attempt_id::text AS attempt_id,fence::float8 AS fence,payload_digest,lease_until
             FROM shared_jobs WHERE control_tenant_id=$1 AND business_key=$2 FOR UPDATE`,
            [bindingRow.rows[0].control_tenant_id, key])
          if (!authority.rowCount) throw new StaleFenceError('job_unavailable')
          const row = authority.rows[0]
          if (!options.trustWorkerClaim) {
            if (row.state !== 'running' || row.attempt_id !== attemptId || Number(row.fence) !== fence ||
                row.payload_digest !== payloadDigest(job) || !row.lease_until || new Date(row.lease_until).getTime() <= Date.now())
              throw new StaleFenceError('stale_fence')
          }
          await restoreBackupToNewTarget(control, options.connect, {
            approvalId: job.approvalId,
            actor: { issuer: row.issuer, actorUid: Number(row.actor_uid) },
          })
          await client.query('COMMIT')
        } catch (error) {
          if (controlHeld) { try { await client.query('ROLLBACK') } catch { /* original error wins */ } }
          throw error
        } finally { client.release() }
        return
      }
      // Defense in depth only. The physical guarantee is the authority row
      // lock below: a lying callback must not unlock an effect.
      await assertOwned()
      const key = businessKey(job)
      const digest = payloadDigest(job)
      const client = await control.connect()
      let controlHeld = false
      try {
        // Authority serialization point: hold the job row lock across the
        // effect write so lease expiry cannot interleave between the check
        // and the effect.
        await client.query('BEGIN')
        controlHeld = true
        const bindingRow = await client.query(
          'SELECT control_tenant_id FROM shared_registry_bindings WHERE tenant_id=$1',
          [job.binding.tenantId])
        if (!bindingRow.rowCount) throw new StaleFenceError('binding_unavailable')
        const authority = await client.query(
          `SELECT state, attempt_id::text AS attempt_id, fence::float8 AS fence, payload_digest, lease_until
           FROM shared_jobs WHERE control_tenant_id=$1 AND business_key=$2 FOR UPDATE`,
          [bindingRow.rows[0].control_tenant_id, key])
        if (!options.trustWorkerClaim) {
          if (!authority.rowCount) throw new StaleFenceError('job_unavailable')
          const row = authority.rows[0]
          if (row.state !== 'running' || row.attempt_id !== attemptId || Number(row.fence) !== fence ||
              row.payload_digest !== digest || !row.lease_until || new Date(row.lease_until).getTime() <= Date.now())
            throw new StaleFenceError('stale_fence')
        }
        // Effect write to the tenant database, still under the authority lock.
        const storage = await options.connect(job.binding.database)
        try {
          await storage.pool.query('BEGIN')
          await storage.pool.query('INSERT INTO shared_fencing(tenant_id,fence) VALUES($1,0) ON CONFLICT DO NOTHING', [job.binding.tenantId])
          const current = await storage.pool.query('SELECT fence::float8 AS fence FROM shared_fencing WHERE tenant_id=$1 FOR UPDATE', [job.binding.tenantId])
          const stored = Number(current.rows[0].fence)
          if (fence < stored) throw new StaleFenceError('stale_fence')
          const existing = await storage.pool.query(
            'SELECT attempt_id::text AS attempt_id, fence::float8 AS fence, payload_digest FROM shared_effects WHERE tenant_id=$1 AND business_key=$2 FOR UPDATE',
            [job.binding.tenantId, key])
          if (existing.rowCount) {
            const row = existing.rows[0]
            if (row.attempt_id !== attemptId || Number(row.fence) !== fence || row.payload_digest !== digest) throw new StaleFenceError('effect_conflict')
            // Idempotent same-attempt retry: no second effect.
            await storage.pool.query('COMMIT')
            await client.query('COMMIT')
            return
          }
          if (fence > stored) await storage.pool.query('UPDATE shared_fencing SET fence=$1 WHERE tenant_id=$2', [fence, job.binding.tenantId])
          await storage.pool.query(
            'INSERT INTO shared_effects(tenant_id,business_key,payload_digest,attempt_id,fence) VALUES($1,$2,$3,$4,$5)',
            [job.binding.tenantId, key, digest, attemptId, fence])
          if (job.operation === 'provision') {
            // Same tenant transaction as the effect: policy derived from the
            // server-side catalog policy carried in the authoritative payload.
            await storage.pool.query('INSERT INTO shared_tenant_policy(tenant_id,policy_revision,features) VALUES($1,$2,$3::jsonb)',
              [job.binding.tenantId, INITIAL_POLICY_REVISION, JSON.stringify(job.policy.features)])
          }
          await storage.pool.query('COMMIT')
        } catch (error) {
          try { await storage.pool.query('ROLLBACK') } catch { /* connection already closed */ }
          throw error
        } finally { await storage.pool.end() }
        await client.query('COMMIT')
      } catch (error) {
        if (controlHeld) { try { await client.query('ROLLBACK') } catch { /* original error wins */ } }
        throw error
      } finally { client.release() }
    },
  }
}
