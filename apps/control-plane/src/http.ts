import {approveOdooRestore,odooJobProgress} from './shared/odoo-backup.js'
import {loadSharedRuntimeConfig} from './shared/runtime-config.js'
import { sharedOnboardingRequestSchema } from '@nasq/commercial-contracts'
import { onboardSharedTenant, sharedProvisioningProgress, sharedOnboardingEnabled } from './shared/onboarding.js'
import { z } from 'zod'
import { enqueueSharedJob } from './shared/job-store.js'
import { createHash, randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Pool, PoolClient } from 'pg'
import { operationRequestSchema, operationsGrantSchema, reasonRequestSchema, retryRequestSchema, tenantCreateSchema, type VendorCapability } from '@nasq/commercial-contracts'
import { verifyServiceRequest } from '@nasq/commercial-contracts/server'
import type { Config } from './config.js'
import { hasUnresolvedMutation, transaction } from './db.js'
import { publishRegistryMutation, recoverRegistry, RegistryError, registryMutationSchema } from './shared/registry-store.js'

const exec = promisify(execFile)
// No shared durable publisher/fenced adapter is wired. Never fall back to the
// dedicated inventory in a shared (or misspelled) process configuration.
export function dedicatedExecutionEnabled(): boolean {
  return (process.env.NASQ_TENANCY_MODE ?? 'dedicated') === 'dedicated'
}
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const TENANT_FIELDS = 'id,name,commercial_mode,hosting_model,inventory_target,catalog_version,catalog_tier,status,desired_policy,observed_policy,policy_revision,health_checked_at,operations_enabled,created_at'
const OP_FIELDS = 'id,tenant_id,type,status,stage,request_id,reason,result,created_at,updated_at'
// A restore request carries no caller-owned authority: only the approval ID.
const restoreRequestSchema = z.strictObject({
  schemaVersion: z.literal(1), requestId: z.uuid(), operation: z.literal('restore'), approvalId: z.uuid(),
})

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public field?: string) { super(message) }
}

function respond(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
  res.end(JSON.stringify(data))
}

async function bodyBytes(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk)
    size += bytes.length
    if (size > 65536) throw new ApiError(413, 'too_large', 'Request body is too large')
    chunks.push(bytes)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function parseJson<T>(raw: string, schema: { safeParse(value: unknown): { success: boolean; data?: T; error?: { issues: Array<{ path: PropertyKey[] }> } } }): T {
  let value: unknown
  try { value = JSON.parse(raw) } catch { throw new ApiError(422, 'invalid', 'Invalid JSON body') }
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw new ApiError(422, 'invalid', 'Invalid request body', String(parsed.error?.issues[0]?.path[0] ?? 'body'))
  return parsed.data as T
}

export type OperatorTarget = { kind: 'scratch' | 'customer'; commercial_mode: 'saas' | 'non_saas'; release_root?: string }
export type TargetLane =
  | { kind: 'scratch'; target: OperatorTarget }
  | { kind: 'compose-local'; target: { kind: 'customer'; commercial_mode: 'saas' }; inventoryPath: string; stateDir: string; descriptorDigest: string; descriptorBytes: Buffer; catalogVersion: string; catalogSha256: string; allowedOperations: string[] }

async function readInventoryFile(path: string): Promise<unknown> {
  const file = await stat(path)
  if (!file.isFile() || file.size > 65536) throw new ApiError(503, 'inventory_unavailable', 'Operator inventory is unavailable')
  try { return JSON.parse(await readFile(path, 'utf8')) } catch { throw new ApiError(503, 'inventory_unavailable', 'Operator inventory is unavailable') }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export async function inventory(config: Config): Promise<{ version: number; targets: Record<string, OperatorTarget> }> {
  const raw = await readInventoryFile(config.inventoryPath)
  const data = raw as { version?: number; targets?: Record<string, { kind?: string; database?: string; classification_file?: string; release_root?: string }> }
  if (data.version !== 2 || !data.targets || typeof data.targets !== 'object' || Array.isArray(data.targets)) throw new ApiError(503, 'inventory_unavailable', 'Operator inventory is unavailable')
  const targets: Record<string, { kind: 'scratch' | 'customer'; commercial_mode: 'saas' | 'non_saas'; release_root?: string }> = {}
  for (const [id, item] of Object.entries(data.targets)) {
    if (!/^[a-z][a-z0-9._-]{0,63}$/.test(id) || !item || (item.kind !== 'scratch' && item.kind !== 'customer') || !item.classification_file || !item.database) throw new ApiError(503, 'inventory_unavailable', 'Operator inventory is unavailable')
    const classification = JSON.parse(await readFile(item.classification_file, 'utf8')) as { schema_version?: number; database?: string; commercial_mode?: string; entitlement_source?: string }
    if (classification.schema_version !== 1 || classification.database !== item.database || !['saas','non_saas'].includes(classification.commercial_mode ?? '') || classification.entitlement_source !== (classification.commercial_mode === 'saas' ? 'control_plane' : 'local_policy')) throw new ApiError(503, 'inventory_unavailable', 'Operator inventory classification is invalid')
    targets[id] = { kind: item.kind, commercial_mode: classification.commercial_mode as 'saas' | 'non_saas', release_root: item.release_root }
  }
  return { version: 2, targets }
}

export async function resolveTargetLane(config: Config, targetId: string, commercialMode: 'saas' | 'non_saas'): Promise<TargetLane> {
  if (!dedicatedExecutionEnabled()) throw new ApiError(503, 'shared_execution_unavailable', 'Shared execution is unavailable')
  if (!/^[a-z][a-z0-9._-]{0,63}$/.test(targetId)) throw new ApiError(422, 'target_not_authorized', 'Operator target is not authorized')
  const scratch = (await inventory(config)).targets[targetId]
  if (scratch && config.managedInventoryPath) {
    const managedRaw = await readInventoryFile(config.managedInventoryPath)
    const managedData = managedRaw as { schema_version?: unknown; targets?: unknown }
    if (managedData.schema_version === 3 && managedData.targets && typeof managedData.targets === 'object' && !Array.isArray(managedData.targets) && Object.hasOwn(managedData.targets, targetId)) {
      throw new ApiError(422, 'target_not_authorized', 'Operator target is not authorized')
    }
  }
  if (scratch) {
    if (scratch.kind !== 'scratch' || scratch.commercial_mode !== commercialMode) throw new ApiError(422, 'target_not_authorized', 'Operator target is not authorized')
    return { kind: 'scratch', target: scratch }
  }
  if (commercialMode !== 'saas' || !config.managedInventoryPath) throw new ApiError(422, 'target_not_authorized', 'Operator target is not authorized')
  const raw = await readInventoryFile(config.managedInventoryPath)
  const data = raw as { schema_version?: unknown; targets?: unknown }
  if (data.schema_version !== 3 || !data.targets || typeof data.targets !== 'object' || Array.isArray(data.targets)) throw new ApiError(503, 'inventory_unavailable', 'Managed inventory is unavailable')
  const targets = data.targets as Record<string, unknown>
  const descriptor = targets[targetId]
  if (!/^tgt_[a-z0-9_]{1,59}$/.test(targetId) || !descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) throw new ApiError(422, 'target_not_authorized', 'Operator target is not authorized')
  const entry = descriptor as Record<string, unknown>
  const adapter = entry.adapter as Record<string, unknown> | undefined
  const resources = entry.resource_refs as Record<string, unknown> | undefined
  const databaseName = resources?.db_name
  const ports = resources?.ports as Record<string, unknown> | undefined
  const secrets = entry.secret_refs as Record<string, unknown> | undefined
  const release = entry.release_ref as Record<string, unknown> | undefined
  const allowedOperations = ['tenant.preflight', 'tenant.inspect', 'health', 'tenant.create', 'tenant.entitle']
  const identityKind = release?.identity_kind
  const releaseImages = ['odoo_image', 'web_image', 'proxy_image']
  if (Object.keys(entry).sort().join(',') !== ['adapter','allowed_operations','commercial_mode','descriptor_digest','environment_id','release_ref','resource_refs','revision','secret_refs'].sort().join(',') ||
      !adapter || Object.keys(adapter).sort().join(',') !== 'kind,version' || adapter.kind !== 'compose-local' || adapter.version !== 1 || entry.commercial_mode !== 'saas' ||
      typeof entry.environment_id !== 'string' || !/^[a-z][a-z0-9-]{0,62}$/.test(entry.environment_id) ||
      !resources || Object.keys(resources).sort().join(',') !== 'backup_root,compose_file,data_dir,db_name,ports,project' ||
      typeof resources.project !== 'string' || !/^[a-z][a-z0-9-]{0,62}$/.test(resources.project) ||
      typeof databaseName !== 'string' || !/^nasq_scratch_[a-z0-9_]{1,42}$/.test(databaseName) || ['odoo19', 'production', 'prod', 'postgres', 'template0', 'template1'].some((token) => databaseName.split('_').includes(token)) ||
      ['compose_file','data_dir','backup_root'].some((key) => typeof resources[key] !== 'string' || !(resources[key] as string).startsWith('/') || (resources[key] as string).split('/').includes('..')) ||
      !ports || Object.keys(ports).sort().join(',') !== 'db,odoo,web' || ['db','odoo','web'].some((key) => !Number.isSafeInteger(ports[key]) || (ports[key] as number) < 1 || (ports[key] as number) > 65535 || [80, 443, 3000, 5432, 8069, 8072].includes(ports[key] as number)) || new Set(['db','odoo','web'].map((key) => ports[key])).size !== 3 ||
      !secrets || Object.keys(secrets).sort().join(',') !== 'admin_password,db_password' || ['admin_password','db_password'].some((key) => typeof secrets[key] !== 'string' || !(secrets[key] as string)) ||
      !release || Object.keys(release).sort().join(',') !== 'catalog_sha256,catalog_version,identity_kind,odoo_image,proxy_image,web_image' ||
      ['catalog_version','odoo_image','web_image','proxy_image'].some((key) => typeof release[key] !== 'string' || !(release[key] as string)) ||
      typeof release.catalog_sha256 !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(release.catalog_sha256) || !['image_id','repo_digest'].includes(String(identityKind)) ||
      (identityKind === 'image_id' && releaseImages.some((key) => typeof release[key] !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(release[key] as string))) ||
      !Array.isArray(entry.allowed_operations) || entry.allowed_operations.length === 0 || entry.allowed_operations.some((operation) => !allowedOperations.includes(String(operation))) || !entry.allowed_operations.includes('tenant.create') ||
      !Number.isSafeInteger(entry.revision) || (entry.revision as number) < 0 ||
      typeof entry.descriptor_digest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(entry.descriptor_digest)) {
    throw new ApiError(422, 'target_not_authorized', 'Managed target descriptor is not authorized')
  }
  const descriptorForDigest = Object.fromEntries(Object.entries(entry).filter(([key]) => key !== 'descriptor_digest'))
  const descriptorBytes = Buffer.from(canonicalJson({ target: targetId, descriptor: descriptorForDigest }), 'utf8')
  const digest = `sha256:${createHash('sha256').update(descriptorBytes).digest('hex')}`
  if (digest !== entry.descriptor_digest) throw new ApiError(422, 'target_not_authorized', 'Managed target descriptor is not authorized')
  return { kind: 'compose-local', target: { kind: 'customer', commercial_mode: 'saas' }, inventoryPath: config.managedInventoryPath, stateDir: config.stateDir, descriptorDigest: digest, descriptorBytes, catalogVersion: release.catalog_version as string, catalogSha256: release.catalog_sha256 as string, allowedOperations: entry.allowed_operations as string[] }
}

async function authorize(pool: Pool, req: IncomingMessage, raw: string, config: Config): Promise<{ actor: number; capabilities: VendorCapability[] }> {
  const signed = verifyServiceRequest({ method: req.method ?? '', path: req.url ?? '', body: raw, key: config.key, headers: req.headers })
  if (!signed || signed.issuer !== config.installationId) throw new ApiError(401, 'unauthorized', 'Invalid service assertion')
  return transaction(pool, async (client) => {
    await client.query('DELETE FROM service_nonces WHERE expires_at < now()')
    const nonce = await client.query('INSERT INTO service_nonces(issuer,nonce,expires_at) VALUES($1,$2,now()+interval \'60 seconds\') ON CONFLICT DO NOTHING RETURNING nonce', [signed.issuer, signed.nonce])
    if (!nonce.rowCount) throw new ApiError(401, 'unauthorized', 'Replayed service assertion')
    const membership = await client.query('SELECT capabilities FROM vendor_memberships WHERE issuer=$1 AND actor_uid=$2 AND revoked_at IS NULL', [signed.issuer, signed.actor])
    if (!membership.rowCount) throw new ApiError(403, 'forbidden', 'Vendor membership is not active')
    return { actor: signed.actor, capabilities: membership.rows[0].capabilities as VendorCapability[] }
  })
}

function requireCapability(auth: { capabilities: VendorCapability[] }, capability: VendorCapability): void {
  if (!auth.capabilities.includes(capability)) throw new ApiError(403, 'forbidden', 'Vendor capability is required')
}

function pageFrom(url: URL): number {
  const page = Number(url.searchParams.get('page') ?? '1')
  if (!Number.isInteger(page) || page < 1 || page > 10000) throw new ApiError(422, 'invalid', 'Invalid page', 'page')
  return page
}

async function availableTenantOperations(pool: Pool, config: Config, tenant: Record<string, unknown>): Promise<string[]> {
  if (!dedicatedExecutionEnabled() || tenant.operations_enabled !== true) return []
  const lane = await resolveTargetLane(config, String(tenant.inventory_target), tenant.commercial_mode as 'saas' | 'non_saas')
  if (tenant.status === 'registered') {
    if (!tenant.catalog_version || !tenant.catalog_tier) return []
    if (lane.kind === 'compose-local') {
      const catalog = await pool.query('SELECT solution,source_sha256 FROM catalog_entries WHERE version=$1 AND status=$2', [tenant.catalog_version, 'published'])
      if (!catalog.rowCount || tenant.catalog_version !== lane.catalogVersion || `sha256:${catalog.rows[0].source_sha256}` !== lane.catalogSha256 || !(catalog.rows[0].solution?.tiers as Array<{ id: string }> | undefined)?.some((tier) => tier.id === tenant.catalog_tier)) return []
    }
    return lane.kind === 'compose-local' && !lane.allowedOperations.includes('tenant.create') ? [] : ['tenant.create']
  }
  if (tenant.status !== 'active') return []
  if (lane.kind === 'compose-local') return ['tenant.inspect', 'health'].filter((operation) => lane.allowedOperations.includes(operation))
  return ['tenant.inspect', 'health', 'backup', ...(tenant.commercial_mode === 'saas' && tenant.catalog_version && tenant.catalog_tier ? ['tenant.entitle'] : [])]
}

async function audit(client: PoolClient, actor: number | string, action: string, subject: string, reason: string): Promise<void> {
  await client.query('INSERT INTO audit_events(id,actor,action,subject,reason) VALUES($1,$2,$3,$4,$5)', [randomUUID(), String(actor), action, subject, reason])
}

function digest(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex') }

async function operationDetail(pool: Pool, id: string) {
  const row = await pool.query(`SELECT ${OP_FIELDS} FROM operations WHERE id=$1`, [id])
  if (!row.rowCount) throw new ApiError(404, 'not_found', 'Operation not found')
  const events = await pool.query('SELECT stage,status,at FROM operation_events WHERE operation_id=$1 ORDER BY id', [id])
  return { ...row.rows[0], events: events.rows }
}

async function enqueue(pool: Pool, config: Config, auth: { actor: number }, tenantId: string, value: Record<string, unknown>): Promise<{ status: number; data: unknown }> {
  if (!dedicatedExecutionEnabled()) throw new ApiError(503, 'shared_execution_unavailable', 'Shared execution is unavailable')
  const input = parseJson(JSON.stringify(value), operationRequestSchema)
  const requestId = String(input.request_id)
  const kind = String(input.type)
  return transaction(pool, async (client) => {
    const tenantQuery = await client.query('SELECT * FROM tenants WHERE id=$1 FOR UPDATE', [tenantId])
    if (!tenantQuery.rowCount) throw new ApiError(404, 'not_found', 'Installation not found')
    const tenant = tenantQuery.rows[0]
    const original = await client.query(`SELECT ${OP_FIELDS},payload_digest,actor_uid,issuer FROM operations WHERE request_id=$1`, [requestId])
    const payloadDigest = digest(input)
    if (original.rowCount) {
      if (String(original.rows[0].actor_uid) !== String(auth.actor) || original.rows[0].issuer !== config.installationId || original.rows[0].tenant_id !== tenantId || original.rows[0].payload_digest !== payloadDigest) throw new ApiError(409, 'conflict', 'Request ID is already in use')
      const { payload_digest: _digest, actor_uid: _actor, issuer: _issuer, ...data } = original.rows[0]
      if (data.type === 'status') data.payload = { request_id: (data.payload as Record<string, unknown>).receipt_request_id, operation: (data.payload as Record<string, unknown>).operation, operation_id: (data.payload as Record<string, unknown>).operation_id }
      return { status: 200, data }
    }
    if (['tenant.create','tenant.entitle','backup','upgrade','restore'].includes(kind) && await hasUnresolvedMutation(client, tenantId)) throw new ApiError(409, 'reconciliation_required', 'An unresolved operation requires reconciliation')
    if (!tenant.operations_enabled) throw new ApiError(403, 'operations_disabled', 'Operations are disabled for this installation')
    const lane = await resolveTargetLane(config, tenant.inventory_target, tenant.commercial_mode)
    const target = lane.target
    if (kind === 'tenant.create' && tenant.status !== 'registered') throw new ApiError(409, 'conflict', 'Installation has already entered provisioning')
    if (lane.kind === 'compose-local' && (kind !== 'status' && (kind !== 'tenant.create' && kind !== 'tenant.inspect' && kind !== 'health' || !lane.allowedOperations.includes(kind)))) throw new ApiError(422, 'operation_unavailable', 'This managed operation is not authorized in this slice')
    if (kind === 'tenant.entitle' && tenant.commercial_mode === 'non_saas') throw new ApiError(422, 'local_policy_protected', 'This installation uses an independent local policy')
    if (kind === 'tenant.create') {
      if (!tenant.catalog_version || !tenant.catalog_tier) throw new ApiError(422, 'catalog_required', 'Select a published catalog version and tier before provisioning')
      const catalog = await client.query('SELECT solution,source_sha256 FROM catalog_entries WHERE version=$1 AND status=$2', [tenant.catalog_version, 'published'])
      if (!catalog.rowCount || !(catalog.rows[0].solution?.tiers as Array<{id:string}> | undefined)?.some((tier) => tier.id === tenant.catalog_tier)) throw new ApiError(422, 'catalog_required', 'Published catalog tier is unavailable')
      if (lane.kind === 'compose-local' && (tenant.catalog_version !== lane.catalogVersion || `sha256:${catalog.rows[0].source_sha256}` !== lane.catalogSha256)) throw new ApiError(422, 'catalog_required', 'Published catalog does not match managed target release')
    }
    if (kind !== 'tenant.create' && tenant.status === 'registered') throw new ApiError(422, 'invalid', 'Installation must be provisioned first')
    if (input.type === 'restore') {
      const approval = await client.query('SELECT id FROM restore_approvals WHERE id=$1 AND tenant_id=$2 AND backup_id=$3 AND action=$4 AND expires_at>now() AND used_by IS NULL FOR UPDATE', [input.approval_id, tenantId, input.backup_id, 'restore'])
      if (!approval.rowCount) throw new ApiError(422, 'approval_required', 'A matching persisted restore approval is required')
    }
    if (input.type === 'upgrade') {
      if (lane.kind === 'compose-local' || !(target as OperatorTarget).release_root || !/^[a-z][a-z0-9._-]{0,63}$/.test(String(input.release_id))) throw new ApiError(422, 'invalid', 'Trusted release is unavailable')
      const release = await stat(join((target as OperatorTarget).release_root!, String(input.release_id))).catch(() => null)
      if (!release?.isFile()) throw new ApiError(422, 'invalid', 'Trusted release is unavailable')
    }
    const id = randomUUID()
    // Dedicated enqueue remains compatible with existing migrated installations.
    // Shared enqueue is refused above; its future store must persist a bound job
    // and business_key atomically rather than adding a key to a legacy payload.
    let inserted
    try { inserted = await client.query(`INSERT INTO operations(id,tenant_id,actor_uid,issuer,type,request_id,reason,payload,payload_digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${OP_FIELDS}`, [id, tenantId, auth.actor, config.installationId, kind, requestId, input.reason, input, payloadDigest]) }
    catch (error) {
      if ((error as { code?: string }).code === '23505') {
        if ((error as { constraint?: string }).constraint === 'operations_business_key_unique') throw new ApiError(409, 'conflict', 'Installation has already entered provisioning')
        throw new ApiError(409, 'conflict', 'Request ID is already in use')
      }
      throw error
    }
    await client.query('INSERT INTO operation_events(operation_id,stage,status) VALUES($1,$2,$3)', [id, 'queued', 'queued'])
    if (input.type === 'restore') await client.query('UPDATE restore_approvals SET used_by=$1 WHERE id=$2', [id, input.approval_id])
    if (kind === 'tenant.create') await client.query('UPDATE tenants SET status=$1 WHERE id=$2', ['provisioning', tenantId])
    await audit(client, auth.actor, `operation.${kind}.queued`, tenantId, input.reason)
    return { status: 202, data: inserted.rows[0] }
  })
}

export function createApp(pool: Pool, config: Config & { tls?: { key: Buffer; cert: Buffer } }) {
  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const method = req.method ?? ''
      const path = req.url ?? ''
      if (path === '/healthz' && method === 'GET') {
        await pool.query('SELECT 1')
        return respond(res, 200, { status: 'ok' })
      }
      if (!path.startsWith('/v1/')) throw new ApiError(404, 'not_found', 'Endpoint not found')
      const raw = await bodyBytes(req)
      const auth = await authorize(pool, req, raw, config)
      const url = new URL(path, 'http://localhost')
      const pathname = url.pathname
      if (method === 'POST' && pathname === '/v1/shared/tenants') {
        requireCapability(auth, 'vendor.tenants.manage')
        requireCapability(auth, 'vendor.operations.run')
        const result = await onboardSharedTenant(pool, config, {issuer:config.installationId,actorUid:auth.actor}, parseJson(raw, sharedOnboardingRequestSchema))
        return respond(res, result.replay ? 200 : 202, result)
      }
      const sharedProgress = pathname.match(new RegExp(`^/v1/shared/tenants/(${UUID})/provisioning$`))
      if (method === 'GET' && sharedProgress) {
        requireCapability(auth, 'vendor.read')
        return respond(res, 200, await sharedProvisioningProgress(pool,sharedProgress[1]!))
      }
      const realProgress=pathname.match(new RegExp(`^/v1/shared/tenants/(${UUID})/jobs/(${UUID})$`))
      const realApproval=pathname.match(new RegExp(`^/v1/shared/tenants/(${UUID})/restore-approvals$`))
      if((method==='GET' && realProgress)||(method==='POST' && realApproval)){
        if(process.env.NASQ_TENANCY_MODE!=='shared'||!config.sharedRuntimeConfigPath)throw new ApiError(503,'shared_execution_unavailable','Shared runtime is unavailable')
        const runtime=loadSharedRuntimeConfig(config.sharedRuntimeConfigPath)
        if(realProgress){requireCapability(auth,'vendor.read');return respond(res,200,await odooJobProgress(pool,realProgress[1]!,realProgress[2]!))}
        requireCapability(auth,'vendor.operations.run')
        return respond(res,201,await approveOdooRestore(pool,runtime,{issuer:config.installationId,actorUid:auth.actor},realApproval![1]!,parseJson(raw,z.strictObject({backup_id:z.uuid(),reason:z.string().trim().min(3).max(1000)}))))
      }
      const sharedQueue = pathname.match(new RegExp(`^/v1/shared/tenants/(${UUID})/jobs$`))
      if (method === 'POST' && sharedQueue) {
        requireCapability(auth, 'vendor.operations.run')
        if (process.env.NASQ_TENANCY_MODE !== 'shared' || !config.tenantRegistryPath) throw new ApiError(503, 'shared_execution_unavailable', 'Shared queue is not configured')
        const input = parseJson(raw, z.strictObject({ reason: z.string().trim().min(3).max(1000), job: z.unknown() }))
        // Restore callers supply only the approval ID; binding, backup and
        // target are derived server-side from the durable approval authority.
        const rawJob = input.job ?? null
        const operation = rawJob && typeof rawJob === 'object' && !Array.isArray(rawJob) ? (rawJob as { operation?: unknown }).operation : undefined
        const job = operation === 'restore'
          ? parseJson(JSON.stringify(rawJob), restoreRequestSchema)
          : parseJson(JSON.stringify(rawJob), z.strictObject({
              schemaVersion: z.literal(1), requestId: z.uuid(), operation: z.enum(['provision','backup']),
            }))
        const result = await enqueueSharedJob(pool, sharedQueue[1]!, { issuer: config.installationId, actorUid: auth.actor }, job, input.reason)
        return respond(res, result.replay ? 200 : 202, result)
      }
      if (method === 'POST' && ['/v1/registry/mutations', '/v1/registry/recover'].includes(pathname)) {
        requireCapability(auth, 'vendor.tenants.manage')
        if (!config.tenantRegistryPath) throw new ApiError(503, 'registry_unavailable', 'Registry publication is not configured')
        const actor = { issuer: config.installationId, actorUid: auth.actor }
        const result = pathname === '/v1/registry/mutations'
          ? await publishRegistryMutation(pool, config.tenantRegistryPath, actor, parseJson(raw, registryMutationSchema))
          : await recoverRegistry(pool, config.tenantRegistryPath, actor, parseJson(raw, reasonRequestSchema).reason)
        return respond(res, 200, { snapshotRevision: result.snapshotRevision })
      }
      if (method === 'GET' && pathname === '/v1/context') return respond(res, 200, { enabled: true, capabilities: auth.capabilities, shared_onboarding_enabled: await sharedOnboardingEnabled(config) })
      if (method === 'GET' && pathname === '/v1/overview') {
        requireCapability(auth, 'vendor.read')
        const counts = await pool.query(`SELECT (SELECT count(*)::int FROM tenants) AS tenants, (SELECT count(*)::int FROM tenants WHERE status='active') AS active, (SELECT count(*)::int FROM operations WHERE status IN ('queued','running')) AS pending_operations, (SELECT count(*)::int FROM operations WHERE status IN ('failed','needs_intervention')) AS failed_operations, (SELECT max(health_checked_at) FROM tenants) AS last_health_at`)
        return respond(res, 200, counts.rows[0])
      }
      if (method === 'GET' && pathname === '/v1/targets') {
        requireCapability(auth, 'vendor.tenants.manage')
        const scratchTargets = (await inventory(config)).targets
        let managedTargets: Record<string, unknown> = {}
        if (config.managedInventoryPath) {
          const managedRaw = await readInventoryFile(config.managedInventoryPath)
          const managedData = managedRaw as { schema_version?: unknown; targets?: unknown }
          if (managedData.schema_version !== 3 || !managedData.targets || typeof managedData.targets !== 'object' || Array.isArray(managedData.targets)) throw new ApiError(503, 'inventory_unavailable', 'Managed inventory is unavailable')
          managedTargets = managedData.targets as Record<string, unknown>
          if (Object.keys(managedTargets).some((id) => Object.hasOwn(scratchTargets, id))) throw new ApiError(503, 'inventory_unavailable', 'Operator inventory contains a duplicate target')
        }
        const managedItems = []
        for (const id of Object.keys(managedTargets)) {
          try {
            const lane = await resolveTargetLane(config, id, 'saas')
            if (lane.kind !== 'compose-local') throw new ApiError(503, 'inventory_unavailable', 'Managed target is not authorized')
            managedItems.push({ id, kind: 'customer' as const })
          } catch { throw new ApiError(503, 'inventory_unavailable', 'Managed target inventory is invalid') }
        }
        const items = [
          ...Object.entries(scratchTargets).map(([id, item]) => ({ id, kind: item.kind })),
          ...managedItems,
        ]
        return respond(res, 200, { items, total: items.length })
      }
      if (pathname === '/v1/tenants' && method === 'GET') {
        requireCapability(auth, 'vendor.read')
        const page = pageFrom(url)
        const q = url.searchParams.get('q')?.trim() ?? ''
        const mode = url.searchParams.get('mode') ?? ''
        if (mode && mode !== 'saas' && mode !== 'non_saas') throw new ApiError(422, 'invalid', 'Invalid commercial mode', 'mode')
        const where = `WHERE ($1='' OR name ILIKE '%'||$1||'%') AND ($2='' OR commercial_mode=$2)`
        const result = await pool.query(`SELECT ${TENANT_FIELDS}, count(*) OVER()::int AS total FROM tenants ${where} ORDER BY created_at DESC,id DESC LIMIT 25 OFFSET $3`, [q, mode, (page - 1) * 25])
        return respond(res, 200, { items: result.rows.map(({ total: _total, ...row }) => row), total: result.rows[0]?.total ?? 0 })
      }
      if (pathname === '/v1/tenants' && method === 'POST') {
        requireCapability(auth, 'vendor.tenants.manage')
        const input = parseJson(raw, tenantCreateSchema)
        const lane = await resolveTargetLane(config, input.inventory_target, input.commercial_mode)
        if (lane.kind === 'scratch' && lane.target.kind !== 'scratch') throw new ApiError(422, 'invalid', 'Select an authorized operator target', 'inventory_target')
        const data = await transaction(pool, async (client) => {
          if (input.catalog_version) {
            const catalog = await client.query('SELECT solution,source_sha256 FROM catalog_entries WHERE version=$1 AND status=$2', [input.catalog_version, 'published'])
            if (!catalog.rowCount) throw new ApiError(422, 'invalid', 'Catalog version is not published', 'catalog_version')
            if (!(catalog.rows[0].solution?.tiers as Array<{id:string}> | undefined)?.some((tier) => tier.id === input.catalog_tier)) throw new ApiError(422, 'invalid', 'Catalog tier is not published', 'catalog_tier')
            if (lane.kind === 'compose-local' && (input.catalog_version !== lane.catalogVersion || `sha256:${catalog.rows[0].source_sha256}` !== lane.catalogSha256)) throw new ApiError(422, 'invalid', 'Published catalog does not match managed target release', 'catalog_version')
          }
          try {
            const created = await client.query(`INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,catalog_version,catalog_tier,operations_enabled) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${TENANT_FIELDS}`, [randomUUID(), input.name, input.commercial_mode, input.hosting_model, input.inventory_target, input.catalog_version ?? null, input.catalog_tier ?? null, input.commercial_mode === 'saas'])
            await audit(client, auth.actor, 'tenant.registered', created.rows[0].id, input.reason)
            return created.rows[0]
          } catch (error) { if ((error as { code?: string }).code === '23505') throw new ApiError(409, 'conflict', 'Inventory target is already registered'); throw error }
        })
        return respond(res, 201, data)
      }
      const tenantMatch = pathname.match(new RegExp(`^/v1/tenants/(${UUID})$`))
      if (tenantMatch && method === 'GET') {
        requireCapability(auth, 'vendor.read')
        const result = await pool.query(`SELECT ${TENANT_FIELDS} FROM tenants WHERE id=$1`, [tenantMatch[1]])
        if (!result.rowCount) throw new ApiError(404, 'not_found', 'Installation not found')
        return respond(res, 200, { ...result.rows[0], available_operations: await availableTenantOperations(pool, config, result.rows[0]) })
      }
      const grantMatch = pathname.match(new RegExp(`^/v1/tenants/(${UUID})/operations-grant$`))
      if (grantMatch && method === 'POST') {
        requireCapability(auth, 'vendor.tenants.manage')
        const input = parseJson(raw, operationsGrantSchema)
        const result = await transaction(pool, async (client) => {
          const row = await client.query(`UPDATE tenants SET operations_enabled=$1 WHERE id=$2 RETURNING ${TENANT_FIELDS}`, [input.enabled, grantMatch[1]])
          if (!row.rowCount) throw new ApiError(404, 'not_found', 'Installation not found')
          await audit(client, auth.actor, input.enabled ? 'tenant.operations.enabled' : 'tenant.operations.disabled', grantMatch[1], input.reason)
          return row.rows[0]
        })
        // The grant has committed. A now-unavailable inventory must not turn
        // that committed write into an apparent failed request or grant actions.
        let availableOperations: string[] = []
        try { availableOperations = await availableTenantOperations(pool, config, result) } catch { /* fail closed */ }
        return respond(res, 200, { ...result, available_operations: availableOperations })
      }
      const tenantOpMatch = pathname.match(new RegExp(`^/v1/tenants/(${UUID})/operations$`))
      if (tenantOpMatch && method === 'POST') {
        requireCapability(auth, 'vendor.operations.run')
        const input = parseJson(raw, operationRequestSchema)
        const result = await enqueue(pool, config, auth, tenantOpMatch[1], input)
        return respond(res, result.status, result.data)
      }
      if (pathname === '/v1/operations' && method === 'GET') {
        requireCapability(auth, 'vendor.read')
        const page = pageFrom(url)
        const tenantId = url.searchParams.get('tenant_id') ?? ''
        if (tenantId && !new RegExp(`^${UUID}$`).test(tenantId)) throw new ApiError(422, 'invalid', 'Invalid tenant', 'tenant_id')
        const result = await pool.query(`SELECT ${OP_FIELDS},count(*) OVER()::int AS total FROM operations WHERE ($1='' OR tenant_id=$1::uuid) ORDER BY created_at DESC,id DESC LIMIT 25 OFFSET $2`, [tenantId, (page - 1) * 25])
        return respond(res, 200, { items: result.rows.map(({ total: _total, ...row }) => row), total: result.rows[0]?.total ?? 0 })
      }
      const opMatch = pathname.match(new RegExp(`^/v1/operations/(${UUID})$`))
      if (opMatch && method === 'GET') { requireCapability(auth, 'vendor.read'); return respond(res, 200, await operationDetail(pool, opMatch[1])) }
      const retryMatch = pathname.match(new RegExp(`^/v1/operations/(${UUID})/retry$`))
      if (retryMatch && method === 'POST') {
        requireCapability(auth, 'vendor.operations.run')
        const input = parseJson(raw, retryRequestSchema)
        const old = await pool.query('SELECT tenant_id,type,status FROM operations WHERE id=$1', [retryMatch[1]])
        if (!old.rowCount) throw new ApiError(404, 'not_found', 'Operation not found')
        if (old.rows[0].status !== 'failed' || !['tenant.inspect','health'].includes(old.rows[0].type)) throw new ApiError(422, 'retry_forbidden', 'Only a failed read operation can be retried')
        const result = await enqueue(pool, config, auth, old.rows[0].tenant_id, { type: old.rows[0].type, request_id: input.request_id, reason: input.reason })
        return respond(res, result.status, result.data)
      }
      if (pathname === '/v1/catalog' && method === 'GET') {
        requireCapability(auth, 'vendor.read')
        const result = await pool.query('SELECT id,version,status,solution,created_at FROM catalog_entries ORDER BY created_at DESC')
        return respond(res, 200, { items: result.rows, total: result.rowCount })
      }
      const catalogMatch = pathname.match(new RegExp(`^/v1/catalog/(${UUID})/(validate|publish)$`))
      if (catalogMatch && method === 'POST') {
        requireCapability(auth, 'vendor.catalog.manage')
        const input = parseJson(raw, reasonRequestSchema)
        const id = catalogMatch[1]
        const action = catalogMatch[2]
        const current = await pool.query('SELECT status,source_sha256,solution FROM catalog_entries WHERE id=$1', [id])
        if (!current.rowCount) throw new ApiError(404, 'not_found', 'Catalog entry not found')
        if (current.rows[0].status !== (action === 'validate' ? 'draft' : 'validated')) throw new ApiError(409, 'conflict', 'Catalog transition is unavailable')
        if (action === 'validate') {
          const catalogFile = await readFile(join(config.repositoryRoot, 'deploy/catalog/solutions/platform.json'))
          if (createHash('sha256').update(catalogFile).digest('hex') !== current.rows[0].source_sha256) throw new ApiError(409, 'conflict', 'Catalog source changed; import a new version')
          try { await exec(config.python, ['-B', join(config.repositoryRoot, 'tools/catalog_check.py'), '--root', config.repositoryRoot], { cwd: config.repositoryRoot, timeout: 60000, maxBuffer: 65536 }) }
          catch { throw new ApiError(422, 'catalog_invalid', 'Trusted catalog validation failed') }
        }
        const result = await transaction(pool, async (client) => {
          const row = await client.query('UPDATE catalog_entries SET status=$1,published_at=CASE WHEN $1=$2 THEN now() ELSE published_at END WHERE id=$3 AND status=$4 RETURNING id,version,status,solution,created_at', [action === 'validate' ? 'validated' : 'published', 'published', id, action === 'validate' ? 'draft' : 'validated'])
          if (!row.rowCount) throw new ApiError(409, 'conflict', 'Catalog changed concurrently')
          await audit(client, auth.actor, `catalog.${action}`, id, input.reason)
          return row.rows[0]
        })
        return respond(res, 200, result)
      }
      if (pathname === '/v1/audit' && method === 'GET') {
        requireCapability(auth, 'vendor.audit.read')
        const page = pageFrom(url)
        const result = await pool.query('SELECT id,actor,action,subject,reason,created_at,count(*) OVER()::int AS total FROM audit_events ORDER BY created_at DESC,id DESC LIMIT 25 OFFSET $1', [(page - 1) * 25])
        return respond(res, 200, { items: result.rows.map(({ total: _total, ...row }) => row), total: result.rows[0]?.total ?? 0 })
      }
      throw new ApiError(404, 'not_found', 'Endpoint not found')
    } catch (error) {
      const known = error instanceof Error && ['shared_job_unavailable','shared_backup_unavailable','shared_restore_approval_unavailable','shared_artifact_mismatch','shared_job_forbidden','tenant_operations_unavailable','restore_target_reserved','shared_replay_forbidden','shared_onboarding_forbidden','idempotency_conflict','published_catalog_missing','catalog_tier_missing','shared_adapter_unavailable','shared_onboarding_missing'].includes(error.message) ? new ApiError(error.message.endsWith('forbidden') ? 403 : error.message === 'shared_adapter_unavailable' ? 503 : error.message === 'shared_onboarding_missing' ? 404 : 409,error.message,'Shared onboarding request rejected') : null
      const failure = known ?? (error instanceof ApiError ? error : error instanceof RegistryError ? new ApiError(error.status, error.code, 'Registry operation rejected') : new ApiError(503, 'service_unavailable', 'Control service is unavailable'))
      return respond(res, failure.status, { code: failure.code, message: failure.message, ...(failure.field ? { field: failure.field } : {}) })
    }
  }
  return config.tls ? createHttpsServer(config.tls, handler) : createServer(handler)
}
