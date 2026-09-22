import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Pool, PoolClient } from 'pg'
import type { Config } from './config.js'
import { inventory } from './http.js'
import { hasUnresolvedMutation, transaction } from './db.js'
import { runProcessGroup } from './process-group.js'

const MUTATIONS = new Set(['tenant.create','tenant.entitle','backup','upgrade','restore'])
const LEASE_SECONDS = 120

export function safeProfileFeatures(profile: unknown, expectedMode: unknown): Record<string, boolean | number | null> | null {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile) || (expectedMode !== 'saas' && expectedMode !== 'non_saas')) return null
  const source = profile as Record<string, unknown>
  if (source.commercial_mode !== expectedMode || source.entitlement_source !== (expectedMode === 'saas' ? 'control_plane' : 'local_policy') || typeof source.policy_revision !== 'number' || !Number.isSafeInteger(source.policy_revision) || source.policy_revision < 0) return null
  if (!source.features || typeof source.features !== 'object' || Array.isArray(source.features)) return null
  const entries = Object.entries(source.features)
  if (entries.length < 2 || entries.length > 256) return null
  const result: Record<string, boolean | number | null> = {}
  for (const [key, value] of entries) {
    if (!/^(?:[a-z][a-z0-9_]*\.)+[a-z][a-z0-9_]*$/.test(key) || !(value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1000000000))) return null
    result[key] = value
  }
  if (!Object.hasOwn(result, 'users.limit') || !Object.hasOwn(result, 'storage.limit_mb')) return null
  return result
}

export type Claimed = { client: PoolClient; operation: Record<string, unknown>; tenant: Record<string, unknown>; lockKey: string }

export async function expireLeases(pool: Pool): Promise<number> {
  return transaction(pool, async (client) => {
    await client.query("SELECT id FROM tenants WHERE id IN (SELECT tenant_id FROM operations WHERE status='running' AND lease_until<now()) ORDER BY id FOR UPDATE")
    const expired = await client.query("UPDATE operations SET status=CASE WHEN type IN ('tenant.create','tenant.entitle','backup','upgrade','restore') THEN 'needs_intervention' ELSE 'failed' END,stage='lease_expired',updated_at=now(),lease_until=NULL WHERE status='running' AND lease_until<now() RETURNING id,tenant_id,type,status")
    for (const row of expired.rows) {
      await client.query('INSERT INTO operation_events(operation_id,stage,status) VALUES($1,$2,$3)', [row.id, 'lease_expired', row.status])
      if (row.status === 'needs_intervention') await client.query("UPDATE tenants SET status='needs_intervention' WHERE id=$1", [row.tenant_id])
    }
    return expired.rowCount ?? 0
  })
}

export async function claimNext(pool: Pool): Promise<Claimed | null> {
  const client = await pool.connect()
  try {
    const candidates = await client.query("SELECT o.*,t.inventory_target,t.commercial_mode,t.catalog_version,t.catalog_tier,t.status AS tenant_status,t.operations_enabled FROM operations o JOIN tenants t ON t.id=o.tenant_id WHERE o.status='queued' ORDER BY o.created_at,o.id LIMIT 20")
    for (const candidate of candidates.rows) {
      const lockKey = candidate.inventory_target as string
      const locked = await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [lockKey])
      if (!locked.rows[0].locked) continue
      let claimed = false
      try {
        await client.query('BEGIN')
        const row = await client.query("SELECT o.*,t.inventory_target,t.commercial_mode,t.catalog_version,t.catalog_tier,t.status AS tenant_status,t.operations_enabled FROM operations o JOIN tenants t ON t.id=o.tenant_id WHERE o.id=$1 AND o.status='queued' FOR UPDATE OF o", [candidate.id])
        if (!row.rowCount) { await client.query('ROLLBACK'); continue }
        const active = await client.query("SELECT 1 FROM operations o JOIN tenants t ON t.id=o.tenant_id WHERE t.inventory_target=$1 AND o.status='running' AND o.id<>$2 LIMIT 1", [lockKey, candidate.id])
        if (active.rowCount) { await client.query('ROLLBACK'); continue }
        if (MUTATIONS.has(String(candidate.type)) && await hasUnresolvedMutation(client, String(candidate.tenant_id))) {
          await client.query("UPDATE operations SET status='failed',stage='reconciliation_required',updated_at=now() WHERE id=$1", [candidate.id])
          await client.query('INSERT INTO operation_events(operation_id,stage,status) VALUES($1,$2,$3)', [candidate.id, 'reconciliation_required', 'failed'])
          await client.query('COMMIT')
          continue
        }
        const updated = await client.query(`UPDATE operations SET status='running',stage='claimed',lease_until=now()+interval '${LEASE_SECONDS} seconds',updated_at=now() WHERE id=$1 RETURNING *`, [candidate.id])
        await client.query('INSERT INTO operation_events(operation_id,stage,status) VALUES($1,$2,$3)', [candidate.id, 'claimed', 'running'])
        await client.query('COMMIT')
        claimed = true
        return { client, operation: updated.rows[0], tenant: row.rows[0], lockKey }
      } catch (error) { await client.query('ROLLBACK'); throw error }
      finally { if (!claimed) await client.query('SELECT pg_advisory_unlock(hashtext($1))', [lockKey]) }
    }
    client.release()
    return null
  } catch (error) { client.release(); throw error }
}

async function grantStillActive(pool: Pool, operation: Record<string, unknown>): Promise<boolean> {
  const check = await pool.query("SELECT 1 FROM vendor_memberships WHERE issuer=$1 AND actor_uid=$2 AND revoked_at IS NULL AND 'vendor.operations.run'=ANY(capabilities)", [operation.issuer, operation.actor_uid])
  return Boolean(check.rowCount)
}

async function policyForCreate(pool: Pool, tenant: Record<string, unknown>, config: Config): Promise<{ schema_version: number; channel: string; modules: string[]; features: Record<string, boolean | number | null> }> {
  const result = await pool.query("SELECT solution,source_sha256 FROM catalog_entries WHERE version=$1 AND status='published'", [tenant.catalog_version])
  if (!result.rowCount) throw new Error('published_catalog_missing')
  const source = await readFile(join(config.repositoryRoot, 'deploy/catalog/solutions/platform.json'))
  if (createHash('sha256').update(source).digest('hex') !== result.rows[0].source_sha256) throw new Error('catalog_source_changed')
  const catalog = result.rows[0].solution as { base_modules?: string[]; tiers?: Array<{ id: string; modules?: string[]; features?: string[] }> }
  const tier = catalog.tiers?.find((item) => item.id === tenant.catalog_tier)
  if (!tier || !Array.isArray(catalog.base_modules) || !Array.isArray(tier.modules) || !Array.isArray(tier.features)) throw new Error('catalog_tier_missing')
  const features: Record<string, boolean | number | null> = { 'users.limit': null, 'storage.limit_mb': null }
  for (const entry of tier.features) {
    const [type, key] = entry.split(':')
    if (!key || !/^[a-z][a-z0-9_.]*$/.test(key) || (type !== 'boolean' && type !== 'limit')) throw new Error('catalog_feature_invalid')
    features[key] = type === 'boolean' ? true : null
  }
  return { schema_version: 1, channel: tenant.commercial_mode === 'saas' ? 'control_plane' : 'local_policy', modules: [...catalog.base_modules, ...tier.modules], features }
}

export function publicReceipt(value: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {}
  const stringFields: Record<string, RegExp> = {
    operation_id: /^op_[a-f0-9]{32}$/,
    request_id: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    target: /^[a-z][a-z0-9._-]{0,63}$/,
    operation: /^(tenant\.(create|entitle|inspect)|health|backup|upgrade|restore)$/,
    status: /^(ok|error|conflict|needs_intervention)$/,
    stage: /^[a-z_]{1,64}$/,
    backup_id: /^op_[a-f0-9]{32}$/,
    candidate_backup_id: /^op_[a-f0-9]{32}$/,
    consistency: /^UNVERIFIED$/,
  }
  for (const [key, pattern] of Object.entries(stringFields)) if (typeof value[key] === 'string' && pattern.test(value[key] as string)) output[key] = value[key]
  if (value.schema_version === 1) output.schema_version = 1
  if (typeof value.changed === 'boolean') output.changed = value.changed
  if (typeof value.policy_revision === 'number' && Number.isSafeInteger(value.policy_revision) && value.policy_revision >= 0) output.policy_revision = value.policy_revision
  if (typeof (value.profile as Record<string,unknown> | undefined)?.policy_revision === 'number' && Number.isSafeInteger((value.profile as Record<string,unknown>).policy_revision) && ((value.profile as Record<string,unknown>).policy_revision as number) >= 0) output.policy_revision = (value.profile as Record<string,unknown>).policy_revision
  if (typeof value.policy_verified === 'boolean') output.policy_verified = value.policy_verified
  if (typeof value.deployment_ready === 'boolean') output.deployment_ready = value.deployment_ready
  if (value.error && typeof value.error === 'object') {
    const error = value.error as Record<string, unknown>
    output.error = { code: typeof error.code === 'string' && /^[a-z_]{1,64}$/.test(error.code) ? error.code : 'operation_failed' }
  }
  return output
}

type OperatorResult = { code: number; receipt: Record<string, unknown> }
async function operator(config: Config, args: string[]): Promise<OperatorResult> {
  const env = { ...process.env, NASQ_CLI_INVENTORY: config.inventoryPath, NASQ_CLI_STATE_DIR: config.stateDir, PYTHONPATH: join(config.repositoryRoot, 'tools') }
  const processResult = await runProcessGroup(config.python, ['-B','-m','nasq_cli.operator',...args,'--json'], { cwd: config.repositoryRoot, env, timeoutMs: 7200000, graceMs: 2000, maxOutputBytes: 65536 })
  if (processResult.timedOut || processResult.outputExceeded || processResult.orphaned || !processResult.groupTerminated)
    return { code: 6, receipt: { status:'needs_intervention', stage: processResult.timedOut ? 'operator_timeout' : processResult.outputExceeded ? 'operator_output_limit' : 'operator_group_unconfirmed' } }
  const { stdout, code } = processResult
  try {
    const receipt = JSON.parse(stdout.trim())
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) throw new Error('invalid_receipt')
    return { code, receipt }
  } catch { return { code: code || 5, receipt: { status:'needs_intervention', stage:'operator_output_invalid' } } }
}

async function operatorArgs(pool: Pool, claimed: Claimed, config: Config, temporary: string): Promise<string[]> {
  const op = claimed.operation
  const tenant = claimed.tenant
  const target = String(tenant.inventory_target)
  const type = String(op.type)
  const requestId = String(op.request_id)
  const payload = op.payload as Record<string, unknown>
  const base = ['--target', target]
  if (type === 'tenant.create' || type === 'tenant.entitle') {
    const policy = type === 'tenant.create' ? await policyForCreate(pool, tenant, config) : { schema_version:1, channel:tenant.commercial_mode === 'saas' ? 'control_plane' : 'local_policy', features:payload.features }
    const policyFile = join(temporary, 'policy.json')
    await writeFile(policyFile, JSON.stringify(policy), { mode: 0o600, flag: 'wx' })
    if (type === 'tenant.create') return ['tenant','create',...base,'--policy-file',policyFile,'--request-id',requestId]
    return ['tenant','entitle',...base,'--policy-file',policyFile,'--expected-revision',String(payload.expected_revision),'--request-id',requestId]
  }
  if (type === 'tenant.inspect') return ['tenant','inspect',...base]
  if (type === 'health') return ['health',...base]
  if (type === 'backup') return ['backup',...base,'--request-id',requestId]
  if (type === 'restore') return ['restore',...base,'--backup-id',String(payload.backup_id),'--approval-id',String(payload.approval_id),'--request-id',requestId]
  if (type === 'upgrade') {
    const targetInfo = (await inventory(config)).targets[target]
    if (!targetInfo?.release_root) throw new Error('release_unavailable')
    return ['upgrade',...base,'--release',join(targetInfo.release_root,String(payload.release_id)),'--request-id',requestId]
  }
  throw new Error('operation_unavailable')
}

export async function finishClaim(pool: Pool, claimed: Claimed, status: 'succeeded' | 'failed' | 'needs_intervention', stage: string, result: Record<string, unknown>, desiredPolicy?: Record<string, unknown>, observedPolicy?: Record<string, unknown>): Promise<boolean> {
  return transaction(pool, async (client) => {
    const op = claimed.operation
    await client.query('SELECT id FROM tenants WHERE id=$1 FOR UPDATE', [op.tenant_id])
    const updated = await client.query('UPDATE operations SET status=$1,stage=$2,result=$3,lease_until=NULL,updated_at=now() WHERE id=$4 AND status=$5 AND lease_until>now() RETURNING id', [status, stage, result, op.id, 'running'])
    if (!updated.rowCount) return false
    await client.query('INSERT INTO operation_events(operation_id,stage,status) VALUES($1,$2,$3)', [op.id, stage, status])
    const type = String(op.type)
    if (desiredPolicy) await client.query('UPDATE tenants SET desired_policy=$1 WHERE id=$2', [desiredPolicy, op.tenant_id])
    if (observedPolicy && (status === 'succeeded' || (type === 'tenant.create' && stage === 'deployment_incomplete'))) await client.query('UPDATE tenants SET observed_policy=$1 WHERE id=$2', [observedPolicy, op.tenant_id])
    if (status === 'succeeded' && type === 'tenant.create') await client.query("UPDATE tenants SET status='active',observed_policy=desired_policy,health_checked_at=now() WHERE id=$1", [op.tenant_id])
    if (status === 'succeeded' && type === 'health') await client.query('UPDATE tenants SET health_checked_at=now() WHERE id=$1', [op.tenant_id])
    if (status === 'succeeded' && type === 'tenant.entitle') await client.query('UPDATE tenants SET observed_policy=desired_policy WHERE id=$1', [op.tenant_id])
    if (status === 'succeeded' && type === 'tenant.inspect' && typeof result.policy_revision === 'number') await client.query('UPDATE tenants SET policy_revision=$1 WHERE id=$2', [result.policy_revision, op.tenant_id])
    if (status === 'succeeded' && ['tenant.create','tenant.entitle'].includes(type) && typeof result.policy_revision === 'number') await client.query('UPDATE tenants SET policy_revision=$1 WHERE id=$2', [result.policy_revision, op.tenant_id])
    if (status === 'needs_intervention' && type === 'tenant.create' && typeof result.policy_revision === 'number') await client.query('UPDATE tenants SET policy_revision=$1,health_checked_at=now() WHERE id=$2', [result.policy_revision, op.tenant_id])
    if (status === 'failed' && type === 'tenant.create') await client.query("UPDATE tenants SET status='registered' WHERE id=$1", [op.tenant_id])
    if (status === 'needs_intervention' && MUTATIONS.has(type)) await client.query("UPDATE tenants SET status='needs_intervention' WHERE id=$1", [op.tenant_id])
    await client.query('INSERT INTO audit_events(id,actor,action,subject,reason) VALUES($1,$2,$3,$4,$5)', [randomUUID(),String(op.actor_uid),`operation.${type}.${status}`,String(op.tenant_id),String(op.reason)])
    return true
  })
}

export async function executeClaimed(pool: Pool, claimed: Claimed, config: Config): Promise<void> {
  const op = claimed.operation
  let temporary: string | null = null
  const heartbeat = setInterval(() => { void pool.query("UPDATE operations SET lease_until=now()+interval '120 seconds' WHERE id=$1 AND status='running' AND lease_until>now()", [op.id]).catch(() => {}) }, 30000)
  try {
    if (!await grantStillActive(pool, op)) { await finishClaim(pool, claimed, 'failed', 'grant_revoked', { code:'grant_revoked' }); return }
    const fresh = await pool.query('SELECT inventory_target,commercial_mode,operations_enabled FROM tenants WHERE id=$1', [op.tenant_id])
    if (!fresh.rowCount) { await finishClaim(pool, claimed, 'failed', 'tenant_missing', {code:'tenant_missing'}); return }
    if (MUTATIONS.has(String(op.type)) && await hasUnresolvedMutation(pool, String(op.tenant_id))) {
      await finishClaim(pool, claimed, 'failed', 'reconciliation_required', {code:'reconciliation_required'}); return
    }
    const target = (await inventory(config)).targets[String(claimed.tenant.inventory_target)]
    if (!target || target.kind !== 'scratch' || target.commercial_mode !== fresh.rows[0].commercial_mode || fresh.rows[0].inventory_target !== claimed.tenant.inventory_target || !fresh.rows[0].operations_enabled) {
      await finishClaim(pool, claimed, 'failed', 'target_not_authorized', { code:'target_not_authorized' }); return
    }
    if (op.type === 'restore') {
      const approval = await pool.query("SELECT 1 FROM restore_approvals WHERE id=$1 AND tenant_id=$2 AND backup_id=$3 AND action='restore' AND expires_at>now() AND used_by=$4", [(op.payload as Record<string,unknown>).approval_id, op.tenant_id, (op.payload as Record<string,unknown>).backup_id, op.id])
      if (!approval.rowCount) { await finishClaim(pool, claimed, 'failed', 'approval_revoked', { code:'approval_revoked' }); return }
    }
    temporary = await mkdtemp(join(config.stateDir, 'control-policy-'))
    const args = await operatorArgs(pool, claimed, config, temporary)
    const first = await operator(config, args)
    let receipt = first.receipt
    if (MUTATIONS.has(String(op.type)) && first.code === 0 && receipt.status === 'ok') {
      const durable = await operator(config, ['status','--target',String(claimed.tenant.inventory_target),'--request-id',String(op.request_id)])
      if (durable.code !== 0 || durable.receipt.status !== 'ok' || !/^op_[a-f0-9]{32}$/.test(String(receipt.operation_id)) || durable.receipt.operation_id !== receipt.operation_id || durable.receipt.request_id !== op.request_id || durable.receipt.target !== claimed.tenant.inventory_target) {
        await finishClaim(pool, claimed, 'needs_intervention', 'receipt_unverified', { code:'receipt_unverified' }); return
      }
      receipt = durable.receipt
    }
    let valid = first.code === 0 && receipt.schema_version === 1 && receipt.status === 'ok' && receipt.target === claimed.tenant.inventory_target && receipt.operation === op.type && (!MUTATIONS.has(String(op.type)) || receipt.request_id === op.request_id)
    const inspectedFeatures = op.type === 'tenant.inspect' && valid ? safeProfileFeatures(receipt.profile, claimed.tenant.commercial_mode) : null
    if (op.type === 'tenant.inspect' && !inspectedFeatures) valid = false
    const incompleteCreate = valid && op.type === 'tenant.create' && receipt.deployment_ready !== true
    const status = incompleteCreate ? 'needs_intervention' : valid ? 'succeeded' : (MUTATIONS.has(String(op.type)) && (receipt.status === 'needs_intervention' || receipt.changed === true) ? 'needs_intervention' : 'failed')
    const stage = incompleteCreate ? 'deployment_incomplete' : typeof receipt.stage === 'string' && /^[a-z_]{1,64}$/.test(receipt.stage) ? receipt.stage : 'operator_failed'
    const result = publicReceipt(receipt)
    const desiredPolicy = (status === 'succeeded' || incompleteCreate) && op.type === 'tenant.create' ? (await policyForCreate(pool, claimed.tenant, config)).features
      : status === 'succeeded' && op.type === 'tenant.entitle' ? (op.payload as Record<string,unknown>).features as Record<string,unknown> : undefined
    const observedPolicy = inspectedFeatures ?? (status === 'succeeded' && op.type === 'tenant.entitle' ? desiredPolicy
      : op.type === 'tenant.create' && receipt.policy_verified === true ? desiredPolicy : undefined)
    await finishClaim(pool, claimed, status, stage, result, desiredPolicy, observedPolicy)
  } catch {
    await finishClaim(pool, claimed, MUTATIONS.has(String(op.type)) ? 'needs_intervention' : 'failed', 'worker_error', { code:'worker_error' })
  } finally {
    clearInterval(heartbeat)
    if (temporary) await rm(temporary, { recursive:true, force:true })
    await claimed.client.query('SELECT pg_advisory_unlock(hashtext($1))', [claimed.lockKey]).catch(() => {})
    claimed.client.release()
  }
}
