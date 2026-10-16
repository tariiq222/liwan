import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import type { Pool, PoolClient } from 'pg'
import type { Config } from '../config.js'
import { executeClaimed, type Claimed, type OperatorInvocation } from '../worker.js'
import { vendorActorIssuer } from '../admin-auth/grants.js'

const repo = new URL('../../../../', import.meta.url).pathname
const operationId = `op_${'a'.repeat(32)}`
const requestId = '9a7ab020-474f-4e1a-ae6d-7a32bdd385ca'
const target = 'tgt_customer_1'
const tenantId = randomUUID()

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`
  return JSON.stringify(value)
}

async function config(adapter: (invocation: OperatorInvocation) => Promise<{ code: number; receipt: Record<string, unknown> }>): Promise<Config> {
  const { mkdtemp, writeFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const fixture = await mkdtemp(join(tmpdir(), 'nasq-worker-v2-'))
  const classification = join(fixture, 'classification.json')
  const inventory = join(fixture, 'inventory.json')
  const managed = join(fixture, 'managed.json')
  const digest = `sha256:${'a'.repeat(64)}`
  const descriptor = { adapter: { kind: 'compose-local', version: 1 }, allowed_operations: ['tenant.create'], commercial_mode: 'saas', environment_id: 'env-a',
    release_ref: { catalog_version: 'catalog-v1', catalog_sha256: digest, identity_kind: 'image_id', odoo_image: digest, web_image: digest, proxy_image: digest },
    resource_refs: { project: 'managed-fixture', compose_file: join(fixture, 'compose.yml'), db_name: 'nasq_scratch_managed_fixture', data_dir: join(fixture, 'data'), backup_root: join(fixture, 'backups'), ports: { db: 55433, odoo: 18169, web: 13130 } },
    revision: 1, secret_refs: { db_password: 'db-handle', admin_password: 'admin-handle' } }
  const descriptorDigest = `sha256:${createHash('sha256').update(canonical({ target, descriptor })).digest('hex')}`
  await writeFile(classification, JSON.stringify({ schema_version: 1, database: 'scratch_db', commercial_mode: 'saas', entitlement_source: 'control_plane' }))
  await writeFile(inventory, JSON.stringify({ version: 2, targets: { scratch: { kind: 'scratch', database: 'scratch_db', classification_file: classification } } }))
  await writeFile(managed, JSON.stringify({ schema_version: 3, targets: { [target]: { ...descriptor, descriptor_digest: descriptorDigest } } }))
  return { installationId: 'test', key: 'k'.repeat(32), inventoryPath: inventory, managedInventoryPath: managed, stateDir: fixture, repositoryRoot: repo, python: 'python3', invokeAdapter: adapter }
}

function claim(catalogVersion: string): Claimed {
  const client = { query: vi.fn(async () => ({ rowCount: 1, rows: [] })), release: vi.fn() } as unknown as PoolClient
  return { client, lockKey: target,
    operation: { id: randomUUID(), tenant_id: tenantId, actor_uid: 7, issuer: vendorActorIssuer('test'), type: 'tenant.create', request_id: requestId, reason: 'unit test', payload: {}, status: 'running' },
    tenant: { id: tenantId, inventory_target: target, commercial_mode: 'saas', catalog_version: catalogVersion, catalog_tier: 'core' } }
}

function pool(claimed: Claimed, catalog: unknown): Pool & { finishQueries: Array<{ sql: string; values?: unknown[] }> } {
  const finishQueries: Array<{ sql: string; values?: unknown[] }> = []
  const client = { query: vi.fn(async (sql: string, values?: unknown[]) => { finishQueries.push({ sql, values }); return { rowCount: 1, rows: [] } }), release: vi.fn() }
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('FROM vendor_accounts WHERE id')) return { rowCount: 1, rows: [{}] }
    if (sql.includes('FROM vendor_account_roles')) return { rowCount: 1, rows: [{ role: 'operations' }] }
    if (sql.includes('SELECT inventory_target,commercial_mode,operations_enabled')) return { rowCount: 1, rows: [{ inventory_target: claimed.tenant.inventory_target, commercial_mode: claimed.tenant.commercial_mode, operations_enabled: true }] }
    if (sql.includes('catalog_entries')) return { rowCount: 1, rows: [catalog] }
    if (sql.includes("status='needs_intervention'")) return { rowCount: 0, rows: [] }
    return { rowCount: 1, rows: [] }
  })
  return { query, connect: vi.fn(async () => client), finishQueries } as unknown as Pool & { finishQueries: Array<{ sql: string; values?: unknown[] }> }
}

const receipt = (invocation: OperatorInvocation) => {
  const policy = JSON.parse(invocation.policyBytes!.toString()) as { features: Record<string, unknown>; modules: string[] }
  return { schema_version: 1, status: 'ok', target, operation: 'tenant.create', request_id: requestId, operation_id: operationId,
    deployment_ready: true, policy_verified: true, policy_revision: 1, digest: 'c'.repeat(64), fingerprint: invocation.fingerprint,
    profile: { commercial_mode: 'saas', entitlement_source: 'control_plane', policy_revision: 1, features: policy.features, modules: [...policy.modules, 'base', 'web'] }, expected_modules: [...policy.modules] }
}

async function published(name: string) {
  const bytes = await readFile(`${repo}deploy/catalog/solutions/${name}`)
  return { solution: JSON.parse(bytes.toString()), source_sha256: createHash('sha256').update(bytes).digest('hex') }
}

describe('worker catalog policy wire', () => {
  it.each([
    ['platform_v2.json', { 'branches.extra_limit': 0 }],
    ['platform.json', { 'users.limit': null, 'storage.limit_mb': null }],
  ])('keeps the trusted %s catalog intact through create policy derivation', async (source, expected) => {
    const calls: OperatorInvocation[] = []
    const cfg = await config(async invocation => { calls.push(invocation); return { code: 0, receipt: receipt(invocation) } })
    const c = claim(source)
    await executeClaimed(pool(c, await published(source)), c, cfg)
    expect(calls[0].policyBytes && JSON.parse(calls[0].policyBytes.toString())).toMatchObject({ features: expect.objectContaining(expected) })
    expect(calls[0].policyBytes && JSON.parse(calls[0].policyBytes.toString()).modules).toEqual(['nasq_core', 'nasq_platform', 'nasq_api'])
  })
})
