import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Pool, PoolClient } from 'pg'
import type { Config } from '../config.js'
import { executeClaimed, type Claimed, type OperatorInvocation } from '../worker.js'
import { hasUnresolvedMutation, isScratchDeploymentExemption } from '../db.js'

const operationId = `op_${'a'.repeat(32)}`
const requestId = '9a7ab020-474f-4e1a-ae6d-7a32bdd385ca'
const target = 'tgt_customer_1'
const tenantId = randomUUID()
const repo = join(import.meta.dirname, '../../../../')
let fixture: string

afterEach(async () => { if (fixture) await rm(fixture, { recursive: true, force: true }) })

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`
  return JSON.stringify(value)
}

async function managedConfig(adapter: (invocation: OperatorInvocation) => Promise<{ code: number; receipt: Record<string, unknown> }>): Promise<Config> {
  fixture = await mkdtemp(join(tmpdir(), 'nasq-worker-managed-'))
  const classificationPath = join(fixture, 'classification.json')
  const inventoryPath = join(fixture, 'inventory.json')
  const managedInventoryPath = join(fixture, 'managed.json')
  const descriptor = { adapter: { kind: 'compose-local', version: 1 }, allowed_operations: ['tenant.create'], commercial_mode: 'saas', environment_id: 'env-a', release_ref: 'release-a', resource_refs: [], revision: 1, secret_refs: [] }
  const descriptorDigest = `sha256:${createHash('sha256').update(canonical({ target, descriptor })).digest('hex')}`
  await writeFile(classificationPath, JSON.stringify({ schema_version: 1, database: 'scratch_db', commercial_mode: 'saas', entitlement_source: 'control_plane' }))
  await writeFile(inventoryPath, JSON.stringify({ version: 2, targets: { scratch: { kind: 'scratch', database: 'scratch_db', classification_file: classificationPath } } }))
  await writeFile(managedInventoryPath, JSON.stringify({ schema_version: 3, targets: { [target]: { ...descriptor, descriptor_digest: descriptorDigest } } }))
  return { installationId: 'test', key: 'k'.repeat(32), inventoryPath, managedInventoryPath, stateDir: fixture, repositoryRoot: repo, python: 'python3', invokeAdapter: adapter }
}

function fakeClaim(type: string, commercialMode = 'saas', payload: Record<string, unknown> = {}): Claimed {
  const client = { query: vi.fn(async () => ({ rowCount: 1, rows: [] })), release: vi.fn() } as unknown as PoolClient
  return {
    client, lockKey: target,
    operation: { id: randomUUID(), tenant_id: tenantId, actor_uid: 7, issuer: 'test', type, request_id: requestId, reason: 'unit test', payload, status: 'running' },
    tenant: { id: tenantId, inventory_target: type === 'scratch-health' ? 'scratch' : target, commercial_mode: type === 'scratch-health' ? 'saas' : commercialMode, catalog_version: 'catalog-v1', catalog_tier: 'core' },
  }
}

function fakePool(claim: Claimed, catalog?: unknown): Pool & { finishQueries: Array<{ sql: string; values?: unknown[] }> } {
  const finishQueries: Array<{ sql: string; values?: unknown[] }> = []
  const client = { query: vi.fn(async (sql: string, values?: unknown[]) => { finishQueries.push({ sql, values }); return { rowCount: 1, rows: [] } }), release: vi.fn() }
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('vendor_memberships')) return { rowCount: 1, rows: [{}] }
    if (sql.includes('SELECT inventory_target,commercial_mode,operations_enabled')) return { rowCount: 1, rows: [{ inventory_target: claim.tenant.inventory_target, commercial_mode: claim.tenant.commercial_mode, operations_enabled: true }] }
    if (sql.includes('catalog_entries')) return { rowCount: 1, rows: [catalog] }
    if (sql.includes("status='needs_intervention'")) return { rowCount: 0, rows: [] }
    return { rowCount: 1, rows: [] }
  })
  return { query, connect: vi.fn(async () => client), finishQueries } as unknown as Pool & { finishQueries: Array<{ sql: string; values?: unknown[] }> }
}

const basicReceipt = (operation: string, extras: Record<string, unknown> = {}) => ({ schema_version: 1, status: 'ok', target, operation, request_id: requestId, ...extras })

describe('scratch deployment exemption classifier', () => {
  it('accepts only a server-owned scratch false boolean deployment marker', () => {
    const base = { status: 'ok', policy_verified: true, _control_lane: 'scratch' }
    expect(isScratchDeploymentExemption({ ...base, deployment_ready: false })).toBe(true)
    for (const value of [undefined, null, 'false', true, {}, 0]) {
      const result = { ...base } as Record<string, unknown>
      if (value === undefined) delete result.deployment_ready
      else result.deployment_ready = value
      expect(isScratchDeploymentExemption(result)).toBe(false)
    }
    expect(isScratchDeploymentExemption({ ...base, deployment_ready: false, _control_lane: 'managed' })).toBe(false)
    expect(isScratchDeploymentExemption({ status: 'ok', policy_verified: true, deployment_ready: false })).toBe(false)
  })

  it('keeps invalid deployment_ready values quarantined in the SQL classifier', async () => {
    let query = ''
    const client = { query: vi.fn(async (sql: string) => { query = sql; return { rowCount: 1, rows: [{}] } }) } as unknown as PoolClient
    const unresolved = await hasUnresolvedMutation(client, tenantId)
    expect(unresolved).toBe(true)
    expect(query).toContain("jsonb_typeof(result->'deployment_ready')='boolean'")
    expect(query).toContain("result->'deployment_ready'='false'::jsonb")
    expect(query).toContain("result->>'_control_lane'='scratch'")
    expect(query).toContain('COALESCE(')
  })
})

describe('executeClaimed lanes', () => {
  it('keeps scratch operations on nasq_cli.operator', async () => {
    const calls: OperatorInvocation[] = []
    const claim = fakeClaim('health', 'saas')
    claim.tenant.inventory_target = 'scratch'
    const config = await managedConfig(async (invocation) => { calls.push(invocation); return { code: 0, receipt: { schema_version: 1, status: 'ok', target: 'scratch', operation: 'health' } } })
    const classificationPath = join(fixture!, 'classification.json')
    await writeFile(classificationPath, JSON.stringify({ schema_version: 1, database: 'scratch_db', commercial_mode: 'saas', entitlement_source: 'control_plane' }))
    await writeFile(config.inventoryPath, JSON.stringify({ version: 2, targets: { scratch: { kind: 'scratch', database: 'scratch_db', classification_file: classificationPath } } }))
    await executeClaimed(fakePool(claim), claim, config)
    expect(calls[0].moduleName).toBe('nasq_cli.operator')
    expect(calls[0].env.NASQ_CLI_INVENTORY).toBe(config.inventoryPath)
    expect(calls[0].env.NASQ_MANAGED_INVENTORY).toBeUndefined()
  })

  it('routes managed create and its status check to managed adapter with the identical policy bytes', async () => {
    const calls: OperatorInvocation[] = []
    const catalogSource = await readFile(join(repo, 'deploy/catalog/solutions/platform.json'))
    const solution = JSON.parse(catalogSource.toString())
    const claim = fakeClaim('tenant.create')
    const config = await managedConfig(async (invocation) => {
      calls.push(invocation)
      return calls.length === 1
        ? { code: 0, receipt: basicReceipt('tenant.create', { operation_id: operationId, deployment_ready: false, policy_verified: false }) }
        : { code: 0, receipt: basicReceipt('tenant.create', { operation_id: operationId, deployment_ready: false, policy_verified: false, digest: 'b'.repeat(64), fingerprint: invocation.fingerprint }) }
    })
    const pool = fakePool(claim, { solution, source_sha256: createHash('sha256').update(catalogSource).digest('hex') })
    await executeClaimed(pool, claim, config)
    expect(calls).toHaveLength(2)
    expect(calls.map((call) => call.moduleName)).toEqual(['nasq_cli.managed_runtime', 'nasq_cli.managed_runtime'])
    expect(calls[1].args).toContain('--policy-bytes-file')
    expect(calls[0].policyBytes?.equals(calls[1].policyBytes ?? Buffer.alloc(0))).toBe(true)
    expect(calls[0].env.NASQ_MANAGED_INVENTORY).toBe(config.managedInventoryPath)
    expect(pool.finishQueries.some(({ sql, values }) => sql.includes('UPDATE operations SET status=$1') && values?.[0] === 'needs_intervention' && values?.[1] === 'deployment_incomplete')).toBe(true)
  })

  it('quarantines create when the status receipt is absent or mismatched', async () => {
    const claim = fakeClaim('tenant.create')
    const catalogSource = await readFile(join(repo, 'deploy/catalog/solutions/platform.json'))
    const solution = JSON.parse(catalogSource.toString())
    let calls = 0
    const config = await managedConfig(async (invocation) => {
      calls += 1
      return { code: 0, receipt: basicReceipt('tenant.create', { operation_id: calls === 1 ? operationId : `op_${'b'.repeat(32)}`, deployment_ready: true, policy_verified: true, digest: 'c'.repeat(64), fingerprint: invocation.fingerprint }) }
    })
    const pool = fakePool(claim, { solution, source_sha256: createHash('sha256').update(catalogSource).digest('hex') })
    await executeClaimed(pool, claim, config)
    expect(pool.finishQueries.some(({ sql, values }) => sql.includes('UPDATE operations SET status=$1') && values?.[0] === 'needs_intervention' && values?.[1] === 'receipt_unverified')).toBe(true)
  })

  it('keeps a managed status probe separate from create completion', async () => {
    const calls: OperatorInvocation[] = []
    const claim = fakeClaim('status')
    claim.operation.payload = { operation: 'tenant.create', receipt_request_id: requestId, operation_id: operationId, policy_bytes: '{"schema_version":1,"channel":"control_plane"}' }
    const config = await managedConfig(async (invocation) => { calls.push(invocation); return { code: 0, receipt: basicReceipt('tenant.create', { operation_id: operationId, deployment_ready: true, policy_verified: false, digest: 'c'.repeat(64), fingerprint: invocation.fingerprint }) } })
    const pool = fakePool(claim)
    await executeClaimed(pool, claim, config)
    expect(calls).toHaveLength(1)
    expect(calls[0].moduleName).toBe('nasq_cli.managed_runtime')
    expect(calls[0].args).toContain('--policy-bytes-file')
    expect(calls[0].policyBytes?.toString()).toBe('{"schema_version":1,"channel":"control_plane"}')
    expect(pool.finishQueries.some(({ sql, values }) => sql.includes('UPDATE operations SET status=$1') && values?.[0] === 'failed')).toBe(true)
    expect(pool.finishQueries.some(({ sql }) => sql.includes("SET status='active'"))).toBe(false)
  })

  it('does not route managed health into a create-completion path', async () => {
    const calls: OperatorInvocation[] = []
    const claim = fakeClaim('health')
    const config = await managedConfig(async (invocation) => { calls.push(invocation); return { code: 0, receipt: basicReceipt('health') } })
    const pool = fakePool(claim)
    await executeClaimed(pool, claim, config)
    expect(calls).toHaveLength(1)
    expect(calls[0].moduleName).toBe('nasq_cli.managed_runtime')
    expect(pool.finishQueries.some(({ sql }) => sql.includes("SET status='active'") || sql.includes('observed_policy=desired_policy'))).toBe(false)
  })
})
