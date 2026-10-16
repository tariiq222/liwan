import { actorHolds, actorLabel } from './admin-auth/grants.js'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Pool, PoolClient } from 'pg'
import type { Config } from './config.js'
import { dedicatedExecutionEnabled, inventory, resolveTargetLane, type TargetLane } from './http.js'
import { hasUnresolvedMutation, transaction } from './db.js'
import { runProcessGroup } from './process-group.js'
import { resolveCatalogSource } from './shared/catalog-source.js'
import { derivePolicy } from './shared/catalog-features.js'

const MUTATIONS = new Set(['tenant.create','tenant.entitle','backup','upgrade','restore'])
// Only managed preflight refusals produced before any effect may return a
// registered tenant to a retryable state. An unknown error stays fail-closed.
const EFFECT_FREE_CREATE_REFUSALS = new Set([
  'preflight_unavailable', 'docker_context_unavailable', 'docker_context_not_local',
  'catalog_digest_mismatch', 'image_identity_untrusted', 'compose_file_invalid',
  'database_exists', 'project_shared', 'volume_shared', 'network_shared', 'port_shared',
])
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

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

// Match nasq_cli.journal.payload_digest: exact policy bytes and the full enrolled
// descriptor are length-framed; descriptor_digest itself excludes that field.
function managedRequestDigest(lane: Extract<TargetLane, { kind: 'compose-local' }>, policyBytes: Buffer, fields: Record<string, string>): string {
  const enrollment = JSON.parse(lane.descriptorBytes.toString('utf8'))
  enrollment.descriptor.descriptor_digest = lane.descriptorDigest
  const hash = createHash('sha256').update(canonicalJson(fields)).update('\0target\0').update(lane.descriptorDigest)
  for (const bytes of [policyBytes, Buffer.from(canonicalJson(enrollment), 'utf8')]) {
    const length = Buffer.alloc(8)
    length.writeBigUInt64BE(BigInt(bytes.length))
    hash.update('\0file\0').update(length).update(bytes)
  }
  return hash.digest('hex')
}

type CreatePolicy = Awaited<ReturnType<typeof policyForCreate>>

function verifiedManagedCreate(receipt: Record<string, unknown>, policy: CreatePolicy | undefined, mode: unknown): boolean {
  if (!policy || receipt.deployment_ready !== true || receipt.policy_verified !== true) return false
  const features = safeProfileFeatures(receipt.profile, mode)
  if (!features || canonicalJson(features) !== canonicalJson(policy.features)) return false
  const profile = receipt.profile as Record<string, unknown>
  // This is initial creation, whose independent Python readback requires revision 1.
  if (profile.policy_revision !== 1 || receipt.policy_revision !== profile.policy_revision) return false
  const modules = profile.modules
  if (!moduleList(modules)) return false
  // Odoo installs the closure of policy.modules (implied services, auto-install bridges).
  // The Python readback proves that closure and reports it as expected_modules.
  const expected = receipt.expected_modules
  if (!moduleList(expected) || expected.some(name => !name.startsWith('nasq_'))) return false
  if (!policy.modules.every(name => expected.includes(name))) return false
  // Stock Odoo dependencies are not additional Nasq pillars.
  if (canonicalJson(modules.filter(name => name.startsWith('nasq_')).sort()) !== canonicalJson([...expected].sort())) return false
  return true
}

function moduleList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 1024 && value.every(name => typeof name === 'string' && /^[a-z][a-z0-9_]{0,127}$/.test(name)) && new Set(value).size === value.length
}

export type Claimed = { client: PoolClient; operation: Record<string, unknown>; tenant: Record<string, unknown>; lockKey: string }
export type OperatorInvocation = { moduleName: 'nasq_cli.operator' | 'nasq_cli.managed_runtime'; args: string[]; env: NodeJS.ProcessEnv; policyBytes?: Buffer; descriptorBytes?: Buffer; target?: string; operation?: string; requestId?: string; fingerprint?: string }

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
  if (!dedicatedExecutionEnabled()) return null
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
  return actorHolds(pool, { issuer: String(operation.issuer), actorUid: Number(operation.actor_uid) }, ['vendor.operations.run'])
}

async function policyForCreate(pool: Pool, tenant: Record<string, unknown>, config: Config): Promise<{ schema_version: number; channel: string; modules: string[]; features: Record<string, boolean | number | null> }> {
  const result = await pool.query("SELECT solution,source_sha256 FROM catalog_entries WHERE version=$1 AND status='published'", [tenant.catalog_version])
  if (!result.rowCount) throw new Error('published_catalog_missing')
  try { await resolveCatalogSource(config.repositoryRoot, result.rows[0].source_sha256) } catch { throw new Error('catalog_source_changed') }
  const catalog = result.rows[0].solution as { schema_version?: number; descriptor_grammar?: string; base_modules?: string[]; tiers?: Array<{ id: string; modules?: string[]; features?: string[] }> }
  const tier = catalog.tiers?.find((item) => item.id === tenant.catalog_tier)
  if (!tier || !Array.isArray(catalog.base_modules) || !Array.isArray(tier.modules) || !Array.isArray(tier.features)) throw new Error('catalog_tier_missing')
  // Keep the trusted catalog intact for the shared schema/descriptor parser;
    // schema-2 fields (grammar and inherited core descriptors) are policy inputs.
    const { modules, features } = derivePolicy(catalog, tier.id)
  return { schema_version: 1, channel: tenant.commercial_mode === 'saas' ? 'control_plane' : 'local_policy', modules, features }
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
  if (typeof value.payload_digest === 'string' && /^[a-f0-9]{64}$/.test(value.payload_digest)) output.payload_digest = value.payload_digest
  return output
}

type OperatorResult = { code: number; receipt: Record<string, unknown> }
async function operator(config: Config, args: string[], lane: TargetLane, policyBytes?: Buffer, journalFields?: Record<string, string>): Promise<OperatorResult> {
  const managed = lane.kind === 'compose-local'
  const env = { ...process.env, NASQ_CLI_INVENTORY: config.inventoryPath, NASQ_MANAGED_INVENTORY: managed ? lane.inventoryPath : undefined, NASQ_CLI_STATE_DIR: managed ? lane.stateDir : config.stateDir, PYTHONPATH: join(config.repositoryRoot, 'tools') }
  const moduleName = managed ? 'nasq_cli.managed_runtime' : 'nasq_cli.operator'
  if (config.invokeAdapter) {
    const invocation: import('./worker.js').OperatorInvocation = { moduleName, args, env, policyBytes, descriptorBytes: managed ? lane.descriptorBytes : undefined, target: managed ? journalFields?.target : undefined, operation: managed ? journalFields?.operation : undefined, requestId: managed ? journalFields?.request_id : undefined, fingerprint: managed ? lane.descriptorDigest : undefined }
    const result = await config.invokeAdapter(invocation)
    if (lane.kind === 'compose-local') {
      const receipt = result.receipt
      if (typeof receipt.status !== 'string' || typeof receipt.target !== 'string' || !/^tgt_[a-z0-9_]{1,59}$/.test(receipt.target) || typeof receipt.operation !== 'string' || !/^(tenant\.(create|inspect)|health)$/.test(receipt.operation) || (journalFields && (receipt.target !== journalFields.target || receipt.operation !== journalFields.operation || receipt.request_id !== journalFields.request_id)) || (receipt.request_id !== undefined && (typeof receipt.request_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(receipt.request_id))) || (receipt.operation_id !== undefined && (typeof receipt.operation_id !== 'string' || !/^op_[a-f0-9]{32}$/.test(receipt.operation_id))) || (receipt.stage !== undefined && (typeof receipt.stage !== 'string' || !/^[a-z_]{1,64}$/.test(receipt.stage))) || (receipt.policy_verified !== undefined && typeof receipt.policy_verified !== 'boolean') || (receipt.deployment_ready !== undefined && typeof receipt.deployment_ready !== 'boolean') || (receipt.digest !== undefined && (typeof receipt.digest !== 'string' || !/^[a-f0-9]{64}$/.test(receipt.digest))) || (receipt.fingerprint !== undefined && (typeof receipt.fingerprint !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(receipt.fingerprint)))) return { code: 5, receipt: { status: 'error', error: { code: 'receipt_invalid' } } }
    }
    return result
  }
  const processResult = await runProcessGroup(config.python, ['-B','-m',moduleName,...args,'--json'], { cwd: config.repositoryRoot, env, timeoutMs: 7200000, graceMs: 2000, maxOutputBytes: 65536 })
  if (processResult.timedOut || processResult.outputExceeded || processResult.orphaned || !processResult.groupTerminated)
    return { code: 6, receipt: { status:'needs_intervention', stage: processResult.timedOut ? 'operator_timeout' : processResult.outputExceeded ? 'operator_output_limit' : 'operator_group_unconfirmed' } }
  const { stdout, code } = processResult
  try {
    const receipt = JSON.parse(stdout.trim())
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) throw new Error('invalid_receipt')
    return { code, receipt }
  } catch { return { code: code || 5, receipt: { status:'needs_intervention', stage:'operator_output_invalid' } } }
}

async function operatorArgs(pool: Pool, claimed: Claimed, config: Config, temporary: string, lane: TargetLane): Promise<{ args: string[]; policyBytesFile?: string; policyBytes?: Buffer; journalFields?: Record<string, string> }> {
  const op = claimed.operation
  const tenant = claimed.tenant
  const target = String(tenant.inventory_target)
  const type = String(op.type)
  const requestId = String(op.request_id)
  const payload = op.payload as Record<string, unknown>
  const base = ['--target', target]
  if (type === 'status' && lane.kind === 'compose-local') {
    const request = op.payload as Record<string, unknown>
    if (request.operation !== 'tenant.create' || typeof request.receipt_request_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(request.receipt_request_id) || typeof request.operation_id !== 'string' || !/^op_[a-f0-9]{32}$/.test(request.operation_id) || typeof request.policy_bytes !== 'string' || Buffer.byteLength(request.policy_bytes) > 16384) throw new Error('status_binding_invalid')
    const policyBytes = Buffer.from(request.policy_bytes, 'utf8')
    const policyFile = join(temporary, 'policy-bytes.json')
    await writeFile(policyFile, policyBytes, { mode: 0o600, flag: 'wx' })
    return { args: ['status','--target',target,'--request-id',request.receipt_request_id,'--policy-bytes-file',policyFile], policyBytes, journalFields: { operation: request.operation, target, request_id: request.receipt_request_id } }
  }
  if (type === 'tenant.create' || type === 'tenant.entitle') {
    if (lane.kind === 'compose-local' && type !== 'tenant.create') throw new Error('managed_entitlement_not_wired')
    const policy = type === 'tenant.create' ? await policyForCreate(pool, tenant, config) : { schema_version:1, channel:tenant.commercial_mode === 'saas' ? 'control_plane' : 'local_policy', features:payload.features }
    const policyBytes = Buffer.from(JSON.stringify(policy), 'utf8')
    if (lane.kind === 'compose-local' && (type !== 'tenant.create' || policyBytes.byteLength > 16384)) throw new Error('managed_operation_unavailable')
    const policyFile = join(temporary, 'policy.json')
    await writeFile(policyFile, policyBytes, { mode: 0o600, flag: 'wx' })
    if (type === 'tenant.create') return { args: ['tenant','create',...base,'--policy-file',policyFile,'--request-id',requestId], policyBytesFile: policyFile, policyBytes, journalFields: { operation: type, target, request_id: requestId } }
    if (lane.kind === 'compose-local') throw new Error('managed_entitlement_not_wired')
    return { args: ['tenant','entitle',...base,'--policy-file',policyFile,'--expected-revision',String(payload.expected_revision),'--request-id',requestId], policyBytesFile: policyFile }
  }
  if (type === 'tenant.inspect') return { args: ['tenant','inspect',...base] }
  if (type === 'health') return { args: ['health',...base] }
  if (type === 'backup') return { args: ['backup',...base,'--request-id',requestId] }
  if (type === 'restore') return { args: ['restore',...base,'--backup-id',String(payload.backup_id),'--approval-id',String(payload.approval_id),'--request-id',requestId] }
  if (type === 'upgrade') {
    const targetInfo = (await inventory(config)).targets[target]
    if (!targetInfo?.release_root) throw new Error('release_unavailable')
    return { args: ['upgrade',...base,'--release',join(targetInfo.release_root,String(payload.release_id)),'--request-id',requestId] }
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
    if (status === 'succeeded' && type === 'tenant.create' && result.deployment_ready === true && result.policy_verified === true) await client.query("UPDATE tenants SET status='active',observed_policy=desired_policy,health_checked_at=now() WHERE id=$1", [op.tenant_id])
    if (status === 'succeeded' && type === 'health') await client.query('UPDATE tenants SET health_checked_at=now() WHERE id=$1', [op.tenant_id])
    if (status === 'succeeded' && type === 'tenant.entitle') await client.query('UPDATE tenants SET observed_policy=desired_policy WHERE id=$1', [op.tenant_id])
    if (status === 'succeeded' && type === 'tenant.inspect' && typeof result.policy_revision === 'number') await client.query('UPDATE tenants SET policy_revision=$1 WHERE id=$2', [result.policy_revision, op.tenant_id])
    if (status === 'succeeded' && ['tenant.create','tenant.entitle'].includes(type) && typeof result.policy_revision === 'number') await client.query('UPDATE tenants SET policy_revision=$1 WHERE id=$2', [result.policy_revision, op.tenant_id])
    if (status === 'needs_intervention' && type === 'tenant.create' && typeof result.policy_revision === 'number') await client.query('UPDATE tenants SET policy_revision=$1,health_checked_at=now() WHERE id=$2', [result.policy_revision, op.tenant_id])
    if (status === 'failed' && type === 'tenant.create' && result.deployment_ready !== false) await client.query("UPDATE tenants SET status='registered' WHERE id=$1", [op.tenant_id])
    if (status === 'needs_intervention' && (MUTATIONS.has(type) || (type === 'create' && result.deployment_ready !== true))) await client.query("UPDATE tenants SET status='needs_intervention' WHERE id=$1", [op.tenant_id])
    await client.query('INSERT INTO audit_events(id,actor,action,subject,reason) VALUES($1,$2,$3,$4,$5)', [randomUUID(),actorLabel({ issuer: String(op.issuer), actorUid: Number(op.actor_uid) }),`operation.${type}.${status}`,String(op.tenant_id),String(op.reason)])
    return true
  })
}

export async function executeClaimed(pool: Pool, claimed: Claimed, config: Config): Promise<void> {
  const op = claimed.operation
  let temporary: string | null = null
  const heartbeat = setInterval(() => { void pool.query("UPDATE operations SET lease_until=now()+interval '120 seconds' WHERE id=$1 AND status='running' AND lease_until>now()", [op.id]).catch(() => {}) }, 30000)
  try {
    if (!dedicatedExecutionEnabled()) { await finishClaim(pool, claimed, 'needs_intervention', 'shared_execution_unavailable', { code: 'shared_execution_unavailable' }); return }
    if (!await grantStillActive(pool, op)) { await finishClaim(pool, claimed, 'failed', 'grant_revoked', { code:'grant_revoked' }); return }
    const fresh = await pool.query('SELECT inventory_target,commercial_mode,operations_enabled FROM tenants WHERE id=$1', [op.tenant_id])
    if (!fresh.rowCount) { await finishClaim(pool, claimed, 'failed', 'tenant_missing', {code:'tenant_missing'}); return }
    if (MUTATIONS.has(String(op.type)) && await hasUnresolvedMutation(pool, String(op.tenant_id))) {
      await finishClaim(pool, claimed, 'failed', 'reconciliation_required', {code:'reconciliation_required'}); return
    }
    const lane = await resolveTargetLane(config, String(claimed.tenant.inventory_target), fresh.rows[0].commercial_mode)
    if (fresh.rows[0].inventory_target !== claimed.tenant.inventory_target || !fresh.rows[0].operations_enabled || (lane.kind === 'compose-local' && (fresh.rows[0].commercial_mode !== 'saas' || !['tenant.create','tenant.inspect','health','status'].includes(String(op.type))))) {
      await finishClaim(pool, claimed, 'failed', 'target_not_authorized', { code:'target_not_authorized' }); return
    }
    if (op.type === 'restore') {
      const approval = await pool.query("SELECT 1 FROM restore_approvals WHERE id=$1 AND tenant_id=$2 AND backup_id=$3 AND action='restore' AND expires_at>now() AND used_by=$4", [(op.payload as Record<string,unknown>).approval_id, op.tenant_id, (op.payload as Record<string,unknown>).backup_id, op.id])
      if (!approval.rowCount) { await finishClaim(pool, claimed, 'failed', 'approval_revoked', { code:'approval_revoked' }); return }
    }
    temporary = await mkdtemp(join(config.stateDir, 'control-policy-'))
    const invocation = await operatorArgs(pool, claimed, config, temporary, lane)
    // Retain the policy actually sent, not a later catalog read that may differ.
    const createPolicy: CreatePolicy | undefined = op.type === 'tenant.create' && invocation.policyBytes ? JSON.parse(invocation.policyBytes.toString('utf8')) : undefined
    const expectedManagedDigest = lane.kind === 'compose-local' && invocation.policyBytes && invocation.journalFields
      ? managedRequestDigest(lane, invocation.policyBytes, invocation.journalFields) : undefined
    const first = await operator(config, invocation.args, lane, invocation.policyBytes, invocation.journalFields)
    let receipt = first.receipt
    if (op.type === 'status' && lane.kind === 'compose-local') {
      const request = op.payload as Record<string, unknown>
      if (first.code !== 0 || !/^op_[a-f0-9]{32}$/.test(String(request.operation_id)) || receipt.operation_id !== request.operation_id || receipt.request_id !== request.receipt_request_id || receipt.target !== claimed.tenant.inventory_target || receipt.operation !== request.operation || !expectedManagedDigest || receipt.digest !== expectedManagedDigest || receipt.fingerprint !== lane.descriptorDigest) {
        await finishClaim(pool, claimed, 'needs_intervention', 'receipt_unverified', { code:'receipt_unverified' }); return
      }
    }
    if (['tenant.create','tenant.entitle','backup','upgrade','restore'].includes(String(op.type)) && first.code === 0 && receipt.status === 'ok') {
      let durable: OperatorResult
      if (lane.kind === 'compose-local') {
        if (!invocation.policyBytesFile || invocation.policyBytesFile === '' || !invocation.policyBytes || !invocation.journalFields) { await finishClaim(pool, claimed, 'needs_intervention', 'receipt_unverified', { code:'receipt_unverified' }); return }
        durable = await operator(config, ['status','--target',String(claimed.tenant.inventory_target),'--request-id',String(op.request_id),'--policy-bytes-file',invocation.policyBytesFile], lane, invocation.policyBytes, { target: String(claimed.tenant.inventory_target), operation: String(op.type), request_id: String(op.request_id) })
      } else {
        durable = await operator(config, ['status','--target',String(claimed.tenant.inventory_target),'--request-id',String(op.request_id)], lane)
      }
      if (durable.code !== 0 || durable.receipt.status !== 'ok' || !/^op_[a-f0-9]{32}$/.test(String(receipt.operation_id)) || durable.receipt.operation_id !== receipt.operation_id || durable.receipt.request_id !== op.request_id || durable.receipt.target !== claimed.tenant.inventory_target || durable.receipt.operation !== op.type || (lane.kind === 'compose-local' && (!expectedManagedDigest || durable.receipt.digest !== expectedManagedDigest || durable.receipt.fingerprint !== lane.descriptorDigest))) {
        await finishClaim(pool, claimed, 'needs_intervention', 'receipt_unverified', { code:'receipt_unverified' }); return
      }
      receipt = durable.receipt
    }
    // A managed status operation reads an existing mutation's journal row. Its
    // receipt is bound to that original operation above, not to the lookup type.
    const statusReceiptMatches = op.type === 'status' && lane.kind === 'compose-local' &&
      receipt.operation === (op.payload as Record<string, unknown>).operation
    let valid = first.code === 0 && receipt.schema_version === 1 && receipt.status === 'ok' && receipt.target === claimed.tenant.inventory_target &&
      (receipt.operation === op.type || statusReceiptMatches) && (!MUTATIONS.has(String(op.type)) || receipt.request_id === op.request_id)
    const inspectedFeatures = op.type === 'tenant.inspect' && valid ? safeProfileFeatures(receipt.profile, claimed.tenant.commercial_mode) : null
    if (op.type === 'tenant.inspect' && (!inspectedFeatures || (lane.kind === 'compose-local' &&
        (receipt.policy_verified !== true || receipt.fingerprint !== lane.descriptorDigest)))) valid = false
    if (lane.kind === 'compose-local' && op.type === 'health' &&
        (receipt.health_verified !== true || receipt.policy_verified !== true ||
         receipt.fingerprint !== lane.descriptorDigest || !safeProfileFeatures(receipt.profile, claimed.tenant.commercial_mode))) valid = false
    const managedCreateVerified = valid && op.type === 'tenant.create' && lane.kind === 'compose-local' && verifiedManagedCreate(receipt, createPolicy, claimed.tenant.commercial_mode)
    const incompleteCreate = valid && op.type === 'tenant.create' && (lane.kind === 'compose-local' ? !managedCreateVerified : receipt.deployment_ready !== true)
    const effectFreeManagedRefusal = lane.kind === 'compose-local' && op.type === 'tenant.create' && first.code !== 0 &&
      receipt.schema_version === 1 && receipt.target === claimed.tenant.inventory_target &&
      receipt.request_id === op.request_id && receipt.operation === op.type &&
      receipt.status === 'conflict' && receipt.stage === 'preflight' && receipt.changed === false &&
      EFFECT_FREE_CREATE_REFUSALS.has(String((receipt.error as Record<string, unknown> | undefined)?.code))
    const status = incompleteCreate ? 'needs_intervention' : valid ? 'succeeded' :
      (lane.kind === 'compose-local' && op.type === 'tenant.create' && !effectFreeManagedRefusal) ||
      (MUTATIONS.has(String(op.type)) && (receipt.status === 'needs_intervention' || receipt.changed === true)) ? 'needs_intervention' : 'failed'
    const stage = incompleteCreate ? 'deployment_incomplete' : typeof receipt.stage === 'string' && /^[a-z_]{1,64}$/.test(receipt.stage) ? receipt.stage : 'operator_failed'
    const result = publicReceipt(receipt)
    if (lane.kind === 'compose-local' && op.type === 'tenant.create') {
      result.policy_verified = managedCreateVerified
      result.deployment_ready = managedCreateVerified
      // A rejected profile must not advance revision or imply a health check.
      if (!managedCreateVerified) delete result.policy_revision
      if (effectFreeManagedRefusal) delete result.deployment_ready
      result._control_lane = 'managed'
      delete result.payload_digest
    } else if (lane.kind === 'scratch' && op.type === 'tenant.create') {
      result._control_lane = 'scratch'
    }
    const desiredPolicy = (status === 'succeeded' || incompleteCreate) && op.type === 'tenant.create' ? createPolicy?.features
      : status === 'succeeded' && op.type === 'tenant.entitle' ? (op.payload as Record<string,unknown>).features as Record<string,unknown> : undefined
    const observedPolicy = inspectedFeatures ?? (status === 'succeeded' && op.type === 'tenant.entitle' ? desiredPolicy
      : op.type === 'tenant.create' && lane.kind === 'scratch' && receipt.policy_verified === true ? desiredPolicy : undefined)
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
