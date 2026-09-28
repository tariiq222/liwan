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
import type { SharedJob } from '@nasq/commercial-contracts/shared'
import { businessKey, payloadDigest } from './provisioning.js'
import type { SharedFencedAdapter } from './job-worker.js'

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
}

export function createFencedStorageAdapter(options: FencedStorageAdapterOptions): SharedFencedAdapter {
  const control = options.controlPool
  return {
    async observe(job: SharedJob) {
      const key = businessKey(job)
      const storage = await options.connect(job.binding.database)
      try {
        const rows = await storage.pool.query(
          'SELECT business_key, payload_digest FROM shared_effects WHERE tenant_id=$1 AND business_key=$2',
          [job.binding.tenantId, key])
        if (!rows.rowCount) return { state: 'absent' }
        const row = rows.rows[0]
        // Observed truth, never the caller's assertion: a foreign digest here
        // surfaces as effect_identity_mismatch and quarantines the job.
        return { state: 'present', binding: job.binding, businessKey: row.business_key, payloadDigest: row.payload_digest, verified: true }
      } finally { await storage.pool.end() }
    },
    async applyFenced({ job, attemptId, fence, assertOwned }) {
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
