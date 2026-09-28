// Package-4 shared provision readiness and activation gate. Activation is a
// fresh, gated decision: a tenant becomes 'active' ONLY when its provision
// job is durably verified AND an independent inspection passes every check.
// Anything less keeps the tenant non-active (needs_intervention), with an
// audited refusal naming the failed checks — never a false 'active' and never
// a blind retry. The first administrator is bound to the provisioning request
// identity; no password material is stored anywhere.
import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { z } from 'zod'
import { transaction } from '../db.js'
import { businessKey, payloadDigest, bindJob } from './provisioning.js'
import type { TenantStorage } from './fenced-adapter.js'
import { ensureTenantStorageSchema } from './fenced-adapter.js'

export type ReadinessCheck = { name: string; passed: boolean; detail?: string }
export type ReadinessReport = { ready: boolean; checks: ReadinessCheck[] }

export async function ensureAdminBindingSchema(storage: TenantStorage): Promise<void> {
  await storage.pool.query(`CREATE TABLE IF NOT EXISTS shared_admin (
    tenant_id text PRIMARY KEY,
    request_id uuid NOT NULL,
    login text NOT NULL,
    bound_at timestamptz NOT NULL DEFAULT clock_timestamp()
  )`)
}

/** Bind the first administrator to the provisioning request identity. The
 * provision effect must already exist (digest-matched) in this tenant's
 * database; a re-bind for the same request is idempotent, a different request
 * is refused. No password column exists at all. */
export async function bootstrapFirstAdmin(storage: TenantStorage, input: { tenantId: string; requestId: string; login: string; expectedEffectDigest: string }): Promise<{ jobId: string }> {
  z.string().regex(/^[a-z][a-z0-9_-]{0,62}$/).parse(input.tenantId)
  z.string().min(3).max(100).parse(input.login)
  await ensureAdminBindingSchema(storage)
  return transaction(storage.pool, async client => {
    const key = JSON.stringify(['shared-v1', input.tenantId, 'provision', 'initial'])
    const effect = await client.query('SELECT payload_digest FROM shared_effects WHERE tenant_id=$1 AND business_key=$2', [input.tenantId, key])
    if (!effect.rowCount || effect.rows[0].payload_digest !== input.expectedEffectDigest) throw new Error('admin_binding_requires_verified_provision')
    const existing = await client.query('SELECT request_id::text AS request_id FROM shared_admin WHERE tenant_id=$1', [input.tenantId])
    if (existing.rowCount) {
      if (existing.rows[0].request_id !== input.requestId) throw new Error('admin_already_bound')
      return { jobId: input.requestId }
    }
    await client.query('INSERT INTO shared_admin(tenant_id,request_id,login) VALUES($1,$2,$3)', [input.tenantId, input.requestId, input.login])
    return { jobId: input.requestId }
  })
}

/** Independent inspection. Every check consults primary state (control DB or
 * the tenant's own database); none of them trusts the caller's assertions. */
export async function inspectTenantReadiness(pool: Pool, connect: (database: string) => Promise<TenantStorage>, controlTenantId: string): Promise<ReadinessReport> {
  const checks: ReadinessCheck[] = []
  const authority = await transaction(pool, async client => {
    const job = await client.query(`SELECT state,payload,receipt::text AS receipt FROM shared_jobs WHERE control_tenant_id=$1 AND business_key=$2`, [controlTenantId, JSON.stringify(['shared-v1', await tenantSlug(client, controlTenantId), 'provision', 'initial'])])
    return job.rowCount ? job.rows[0] : null
  })
  async function tenantSlug(client: PoolClient, id: string) {
    const binding = await client.query('SELECT tenant_id FROM shared_registry_bindings WHERE control_tenant_id=$1', [id])
    if (!binding.rowCount) throw new Error('tenant_binding_unavailable')
    return binding.rows[0].tenant_id as string
  }
  const slug = authority ? await transaction(pool, client => tenantSlug(client, controlTenantId)) : null
  checks.push({ name: 'provision_job_verified', passed: authority?.state === 'verified' && Boolean(authority?.receipt), detail: authority?.state ?? 'missing' })
  let payload: unknown = null
  let receiptDigest = ''
  if (authority?.payload) {
    payload = authority.payload
    const parsed = bindJob(authority.payload)
    if (parsed.operation !== 'provision') checks.push({ name: 'provision_operation', passed: false, detail: parsed.operation })
    else {
      checks.push({ name: 'provision_operation', passed: true })
      receiptDigest = payloadDigest(parsed)
    }
  } else checks.push({ name: 'provision_operation', passed: false, detail: 'no_payload' })
  const database = authority ? (bindJob(authority.payload).binding.database) : null
  if (!database) {
    checks.push({ name: 'database_connectivity', passed: false, detail: 'no_binding' })
    return { ready: false, checks }
  }
  const storage = await connect(database)
  try {
    await ensureTenantStorageSchema(storage)
    await ensureAdminBindingSchema(storage)
    checks.push({ name: 'database_connectivity', passed: true, detail: database })
    const effect = await storage.pool.query('SELECT payload_digest FROM shared_effects WHERE tenant_id=$1', [slug])
    checks.push({ name: 'provisioned_effect', passed: effect.rowCount === 1 && effect.rows[0].payload_digest === receiptDigest, detail: `${effect.rowCount ?? 0} rows` })
    const admin = await storage.pool.query('SELECT request_id::text AS request_id, login FROM shared_admin WHERE tenant_id=$1', [slug])
    const requestId = payload && (payload as { requestId?: string }).requestId
    checks.push({ name: 'first_admin_bound', passed: admin.rowCount === 1 && admin.rows[0].request_id === requestId, detail: admin.rowCount ? admin.rows[0].login : 'missing' })
    if (payload) {
      const policy = (payload as { policy?: { modules?: string[] } }).policy
      const modules = policy?.modules ?? []
      const unique = new Set(modules)
      checks.push({ name: 'policy_modules', passed: modules.length > 0 && unique.size === modules.length, detail: modules.join(',') })
    } else checks.push({ name: 'policy_modules', passed: false, detail: 'no_policy' })
    const fencing = await storage.pool.query('SELECT fence::float8 AS fence FROM shared_fencing WHERE tenant_id=$1', [slug])
    checks.push({ name: 'storage_fence', passed: fencing.rowCount === 1 && Number(fencing.rows[0].fence) >= 1, detail: String(fencing.rows[0]?.fence ?? 'missing') })
  } finally { await storage.pool.end() }
  return { ready: checks.every(c => c.passed), checks }
}

/** Activation gate. Re-verifies the job durably inside the transaction, then
 * flips the tenant to 'active' — or records an audited refusal and moves the
 * tenant to needs_intervention. Never invents readiness from a report alone. */
export async function activateSharedTenant(pool: Pool, controlTenantId: string, report: ReadinessReport, actor: { issuer: string; actorUid: number }): Promise<{ activated: boolean }> {
  z.string().trim().min(3).max(1000).parse(report.ready ? 'activation' : 'refusal')
  return transaction(pool, async client => {
    const tenant = await client.query('SELECT id,status FROM tenants WHERE id=$1 FOR UPDATE', [controlTenantId])
    if (!tenant.rowCount) throw new Error('tenant_unavailable')
    const binding = await client.query('SELECT tenant_id FROM shared_registry_bindings WHERE control_tenant_id=$1', [controlTenantId])
    const job = await client.query("SELECT state FROM shared_jobs WHERE control_tenant_id=$1 AND business_key=$2", [controlTenantId, JSON.stringify(['shared-v1', binding.rows[0]?.tenant_id ?? '', 'provision', 'initial'])])
    const failed = report.checks.filter(c => !c.passed).map(c => c.name)
    const durableVerified = job.rows[0]?.state === 'verified'
    if (!durableVerified || !report.ready) {
      await client.query("UPDATE tenants SET status='needs_intervention' WHERE id=$1 AND status<>'active'", [controlTenantId])
      await client.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)',
        [randomUUID(), `${actor.issuer}:${actor.actorUid}`, 'tenant.activation_refused', controlTenantId, 'Readiness or durable verification missing', { failed, durableVerified }])
      return { activated: false }
    }
    await client.query("UPDATE tenants SET status='active',health_checked_at=now() WHERE id=$1 AND status<>'active'", [controlTenantId])
    await client.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)',
      [randomUUID(), `${actor.issuer}:${actor.actorUid}`, 'tenant.activated', controlTenantId, 'All readiness checks passed with a verified provision job', { checks: report.checks.map(c => c.name) }])
    return { activated: true }
  })
}
