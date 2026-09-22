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

const exec = promisify(execFile)
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const TENANT_FIELDS = 'id,name,commercial_mode,hosting_model,inventory_target,catalog_version,catalog_tier,status,desired_policy,observed_policy,policy_revision,health_checked_at,operations_enabled,created_at'
const OP_FIELDS = 'id,tenant_id,type,status,stage,request_id,reason,result,created_at,updated_at'

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

export async function inventory(config: Config): Promise<{ version: number; targets: Record<string, { kind: 'scratch' | 'customer'; commercial_mode: 'saas' | 'non_saas'; release_root?: string }> }> {
  const file = await stat(config.inventoryPath)
  if (!file.isFile() || file.size > 65536) throw new ApiError(503, 'inventory_unavailable', 'Operator inventory is unavailable')
  const data = JSON.parse(await readFile(config.inventoryPath, 'utf8')) as { version?: number; targets?: Record<string, { kind?: string; database?: string; classification_file?: string; release_root?: string }> }
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
      return { status: 200, data }
    }
    if (['tenant.create','tenant.entitle','backup','upgrade','restore'].includes(kind) && await hasUnresolvedMutation(client, tenantId)) throw new ApiError(409, 'reconciliation_required', 'An unresolved operation requires reconciliation')
    if (!tenant.operations_enabled) throw new ApiError(403, 'operations_disabled', 'Operations are disabled for this installation')
    const target = (await inventory(config)).targets[tenant.inventory_target]
    if (!target) throw new ApiError(422, 'invalid', 'Installation target is absent from operator inventory')
    if (target.kind !== 'scratch') throw new ApiError(422, 'operation_unavailable', 'This operation has no verified customer-target adapter')
    if (kind === 'tenant.create' && tenant.status !== 'registered') throw new ApiError(409, 'conflict', 'Installation has already entered provisioning')
    if (kind === 'tenant.entitle' && tenant.commercial_mode === 'non_saas') throw new ApiError(422, 'local_policy_protected', 'This installation uses an independent local policy')
    if (kind === 'tenant.create') {
      if (!tenant.catalog_version || !tenant.catalog_tier) throw new ApiError(422, 'catalog_required', 'Select a published catalog version and tier before provisioning')
      const catalog = await client.query('SELECT solution FROM catalog_entries WHERE version=$1 AND status=$2', [tenant.catalog_version, 'published'])
      if (!catalog.rowCount || !(catalog.rows[0].solution?.tiers as Array<{id:string}> | undefined)?.some((tier) => tier.id === tenant.catalog_tier)) throw new ApiError(422, 'catalog_required', 'Published catalog tier is unavailable')
    }
    if (kind !== 'tenant.create' && tenant.status === 'registered') throw new ApiError(422, 'invalid', 'Installation must be provisioned first')
    if (input.type === 'restore') {
      const approval = await client.query('SELECT id FROM restore_approvals WHERE id=$1 AND tenant_id=$2 AND backup_id=$3 AND action=$4 AND expires_at>now() AND used_by IS NULL FOR UPDATE', [input.approval_id, tenantId, input.backup_id, 'restore'])
      if (!approval.rowCount) throw new ApiError(422, 'approval_required', 'A matching persisted restore approval is required')
    }
    if (input.type === 'upgrade') {
      if (!target.release_root || !/^[a-z][a-z0-9._-]{0,63}$/.test(String(input.release_id))) throw new ApiError(422, 'invalid', 'Trusted release is unavailable')
      const release = await stat(join(target.release_root, String(input.release_id))).catch(() => null)
      if (!release?.isFile()) throw new ApiError(422, 'invalid', 'Trusted release is unavailable')
    }
    const id = randomUUID()
    let inserted
    try { inserted = await client.query(`INSERT INTO operations(id,tenant_id,actor_uid,issuer,type,request_id,reason,payload,payload_digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${OP_FIELDS}`, [id, tenantId, auth.actor, config.installationId, kind, requestId, input.reason, input, payloadDigest]) }
    catch (error) { if ((error as { code?: string }).code === '23505') throw new ApiError(409, 'conflict', 'Request ID is already in use'); throw error }
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
      if (method === 'GET' && pathname === '/v1/context') return respond(res, 200, { enabled: true, capabilities: auth.capabilities })
      if (method === 'GET' && pathname === '/v1/overview') {
        requireCapability(auth, 'vendor.read')
        const counts = await pool.query(`SELECT (SELECT count(*)::int FROM tenants) AS tenants, (SELECT count(*)::int FROM tenants WHERE status='active') AS active, (SELECT count(*)::int FROM operations WHERE status IN ('queued','running')) AS pending_operations, (SELECT count(*)::int FROM operations WHERE status IN ('failed','needs_intervention')) AS failed_operations, (SELECT max(health_checked_at) FROM tenants) AS last_health_at`)
        return respond(res, 200, counts.rows[0])
      }
      if (method === 'GET' && pathname === '/v1/targets') {
        requireCapability(auth, 'vendor.tenants.manage')
        const items = Object.entries((await inventory(config)).targets).map(([id, item]) => ({ id, kind: item.kind }))
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
        const target = (await inventory(config)).targets[input.inventory_target]
        if (!target) throw new ApiError(422, 'invalid', 'Select a target from the operator inventory', 'inventory_target')
        if (target.commercial_mode !== input.commercial_mode) throw new ApiError(422, 'invalid', 'Commercial mode does not match trusted target classification', 'commercial_mode')
        const data = await transaction(pool, async (client) => {
          if (input.catalog_version) {
            const catalog = await client.query('SELECT solution FROM catalog_entries WHERE version=$1 AND status=$2', [input.catalog_version, 'published'])
            if (!catalog.rowCount) throw new ApiError(422, 'invalid', 'Catalog version is not published', 'catalog_version')
            if (!(catalog.rows[0].solution?.tiers as Array<{id:string}> | undefined)?.some((tier) => tier.id === input.catalog_tier)) throw new ApiError(422, 'invalid', 'Catalog tier is not published', 'catalog_tier')
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
        return respond(res, 200, result.rows[0])
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
        return respond(res, 200, result)
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
      const failure = error instanceof ApiError ? error : new ApiError(503, 'service_unavailable', 'Control service is unavailable')
      return respond(res, failure.status, { code: failure.code, message: failure.message, ...(failure.field ? { field: failure.field } : {}) })
    }
  }
  return config.tls ? createHttpsServer(config.tls, handler) : createServer(handler)
}
