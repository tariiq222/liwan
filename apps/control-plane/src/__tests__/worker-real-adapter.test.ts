import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import type { Pool, PoolClient } from 'pg'
import type { Config } from '../config.js'
import { executeClaimed, type Claimed } from '../worker.js'
import { vendorActorIssuer } from '../admin-auth/grants.js'

const repo = join(import.meta.dirname, '../../../../')
const target = 'tgt_worker_e2e'
const requestId = '2ac6741f-36ab-4e39-8faa-625a9cd213e4'
const tenantId = randomUUID()
let fixture = ''
let originalPath: string | undefined

type Query = { sql: string; values?: unknown[] }

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function invoke(args: string[], inventoryPath: string, stateDir: string, path: string): { code: number; receipt: Record<string, unknown> } {
  const child = spawnSync('python3', ['-B', '-m', 'nasq_cli.managed_runtime', ...args, '--json'], {
    cwd: repo, encoding: 'utf8', timeout: 10_000,
    env: { ...process.env, PYTHONPATH: join(repo, 'tools'), NASQ_MANAGED_INVENTORY: inventoryPath, NASQ_CLI_STATE_DIR: stateDir, PATH: `${path}:${process.env.PATH ?? ''}` },
  })
  if (child.error) throw child.error
  const receipt = JSON.parse(child.stdout.trim()) as Record<string, unknown>
  return { code: child.status ?? 255, receipt }
}

async function privateWrite(path: string, bytes: string | Buffer): Promise<void> {
  await writeFile(path, bytes, { mode: 0o600 })
  await chmod(path, 0o600)
}

async function fakeDocker(root: string): Promise<{ path: string; calls: string }> {
  const bin = join(root, 'bin')
  const calls = join(root, 'docker-calls.log')
  await mkdir(bin, { mode: 0o700 })
  const executable = join(bin, 'docker')
  await privateWrite(executable, `#!/bin/sh\nprintf '%s\\n' "$*" >> '${calls}'\nif [ "$1" = context ] && [ "$2" = inspect ]; then\n  printf '%s\\n' '[{"Endpoints":{"docker":{"Host":"unix://${join(root, 'missing-docker.sock')}"}}}]'\n  exit 0\nfi\nexit 97\n`)
  await chmod(executable, 0o700)
  return { path: bin, calls }
}

afterEach(async () => { if (fixture) await rm(fixture, { recursive: true, force: true }); fixture = ''; process.env.PATH = originalPath })

async function setup(): Promise<{ config: Config; managedInventory: string; policyBytes: Buffer; dockerPath: string; dockerCalls: string }> {
  originalPath ??= process.env.PATH
  fixture = await mkdtemp(join(tmpdir(), 'nasq-worker-real-adapter-'))
  const fake = await fakeDocker(fixture)
  process.env.PATH = `${fake.path}:${originalPath ?? ''}`
  const catalogBytes = await readFile(join(repo, 'deploy/catalog/solutions/platform.json'))
  const catalogDigest = `sha256:${createHash('sha256').update(catalogBytes).digest('hex')}`
  const inventoryRoot = join(fixture, 'inventory')
  await mkdir(inventoryRoot, { mode: 0o700 })
  const composeFile = join(inventoryRoot, 'compose.yml')
  await privateWrite(composeFile, 'services: {}\n')
  const descriptor = {
    adapter: { kind: 'compose-local', version: 1 }, commercial_mode: 'saas', environment_id: 'worker-e2e',
    resource_refs: { project: 'worker-e2e', compose_file: composeFile, db_name: 'nasq_scratch_worker_e2e', data_dir: join(fixture, 'data'), backup_root: join(fixture, 'backups'), ports: { db: 25001, odoo: 25002, web: 25003 } },
    secret_refs: { db_password: 'db-handle', admin_password: 'admin-handle' },
    release_ref: { catalog_version: 'worker-v1', catalog_sha256: catalogDigest, identity_kind: 'repo_digest', odoo_image: 'odoo@sha256:test', web_image: 'web@sha256:test', proxy_image: 'proxy@sha256:test' },
    allowed_operations: ['tenant.create', 'health'], revision: 1,
  }
  const descriptorDigest = `sha256:${createHash('sha256').update(canonical({ target, descriptor })).digest('hex')}`
  const managedInventory = join(inventoryRoot, 'managed.json')
  await privateWrite(managedInventory, JSON.stringify({ schema_version: 3, targets: { [target]: { ...descriptor, descriptor_digest: descriptorDigest } } }))
  const policyBytes = Buffer.from('{"schema_version":1,"channel":"control_plane","modules":["nasq_core","nasq_platform","nasq_api"],"features":{"users.limit":null,"storage.limit_mb":null}}')
  await mkdir(join(fixture, 'worker-state'), { mode: 0o700 })
  const policyPath = join(fixture, 'catalog-policy.json')
  await privateWrite(policyPath, policyBytes)
  const inventoryPath = join(inventoryRoot, 'inventory.json')
  await privateWrite(inventoryPath, JSON.stringify({ version: 2, targets: {} }))
  return {
    config: { installationId: 'worker-e2e', key: 'k'.repeat(32), inventoryPath, managedInventoryPath: managedInventory, stateDir: join(fixture, 'worker-state'), repositoryRoot: repo, python: 'python3' },
    managedInventory, policyBytes, dockerPath: fake.path, dockerCalls: fake.calls,
  }
}

function claim(type: string, payload: Record<string, unknown> = {}): Claimed {
  const client = { query: async () => ({ rowCount: 1, rows: [] }), release: () => undefined } as unknown as PoolClient
  return {
    client, lockKey: target,
    operation: { id: randomUUID(), tenant_id: tenantId, actor_uid: 7, issuer: vendorActorIssuer('worker-e2e'), type, request_id: requestId, reason: 'isolated test', payload, status: 'running' },
    tenant: { id: tenantId, inventory_target: target, commercial_mode: 'saas', catalog_version: null, catalog_tier: null },
  }
}

function fakePool(tenant: Claimed['tenant'], publishedCatalog?: { solution: unknown; source_sha256: string }) {
  const finished: Query[] = []
  const tenantUpdates: Query[] = []
  let transactionOpen = false
  const client = {
    query: async (sql: string, values?: unknown[]) => {
      finished.push({ sql, values })
      if (sql === 'BEGIN') { transactionOpen = true; return { rowCount: null, rows: [] } }
      if (sql === 'COMMIT' || sql === 'ROLLBACK') { transactionOpen = false; return { rowCount: null, rows: [] } }
      if (sql.includes('UPDATE tenants')) tenantUpdates.push({ sql, values })
      if (sql.includes('UPDATE operations SET status=$1')) return { rowCount: 1, rows: [{ id: values?.[3] }] }
      return { rowCount: 1, rows: [] }
    },
    release: () => undefined,
  }
  const pool = {
    query: async (sql: string) => {
      if (sql.includes('FROM vendor_accounts WHERE id')) return { rowCount: 1, rows: [{}] }
    if (sql.includes('FROM vendor_account_roles')) return { rowCount: 1, rows: [{ role: 'operations' }] }
      if (sql.includes('SELECT inventory_target,commercial_mode,operations_enabled')) return { rowCount: 1, rows: [{ inventory_target: tenant.inventory_target, commercial_mode: tenant.commercial_mode, operations_enabled: true }] }
      if (sql.includes('catalog_entries')) return publishedCatalog ? { rowCount: 1, rows: [publishedCatalog] } : { rowCount: 0, rows: [] }
      if (sql.includes("status='needs_intervention'")) return { rowCount: 0, rows: [] }
      return { rowCount: 1, rows: [] }
    },
    connect: async () => client,
  } as unknown as Pool
  return { pool, finished, tenantUpdates, get transactionOpen() { return transactionOpen } }
}

describe('executeClaimed with the real managed adapter process', () => {
  it('records a successful valid receipt from the real adapter subprocess', async () => {
    const { config, managedInventory, dockerPath } = await setup()
    const work = claim('health')
    const pg = fakePool(work.tenant)
    const result = invoke(['health', '--target', target], managedInventory, config.stateDir, dockerPath)
    expect(result.code).toBe(4)
    expect(result.receipt).toMatchObject({ status: 'conflict', operation: 'health', target })
    await executeClaimed(pg.pool, work, config)
    expect(pg.finished.some(({ sql, values }) => sql.includes('UPDATE operations SET status=$1') && values?.[0] === 'failed')).toBe(true)
    expect(pg.tenantUpdates.some(({ sql }) => sql.includes('health_checked_at=now()'))).toBe(false)
    expect(pg.tenantUpdates.some(({ sql }) => sql.includes("SET status='active'"))).toBe(false)
  })

  it('quarantines a real managed create receipt whose stored binding is unverified', async () => {
    const { config, managedInventory, policyBytes, dockerPath, dockerCalls } = await setup()
    const work = claim('status', { operation: 'tenant.create', receipt_request_id: requestId, operation_id: `op_${'d'.repeat(32)}`, policy_bytes: policyBytes.toString('utf8') })
    const pg = fakePool(work.tenant)
    // Use the actual adapter to record a durable Docker-context refusal using
    // only the isolated fake executable. Status then validates that receipt.
    const policyPath = join(fixture, 'seed-policy.json')
    await privateWrite(policyPath, policyBytes)
    const seeded = invoke(['tenant', 'create', '--target', target, '--policy-file', policyPath, '--request-id', requestId], managedInventory, config.stateDir, dockerPath)
    expect(seeded.receipt).toMatchObject({ status: 'conflict', stage: 'preflight', error: { code: 'docker_context_unavailable' } })
    await executeClaimed(pg.pool, work, config)
    expect(pg.finished.some(({ sql, values }) => sql.includes('UPDATE operations SET status=$1') && values?.[0] === 'needs_intervention' && values?.[1] === 'receipt_unverified')).toBe(true)
    expect(pg.tenantUpdates.some(({ sql }) => sql.includes("SET status='active'"))).toBe(false)
  })

  it('records the real create preflight refusal once without worker_error or activation (deployment_incomplete remains unproven)', async () => {
    const { config, dockerCalls } = await setup()
    const catalogBytes = await readFile(join(repo, 'deploy/catalog/solutions/platform.json'))
    const solution = JSON.parse(catalogBytes.toString())
    const work = claim('tenant.create')
    work.tenant.catalog_version = 'worker-v1'
    work.tenant.catalog_tier = solution.tiers[0].id
    const pg = fakePool(work.tenant, { solution, source_sha256: createHash('sha256').update(catalogBytes).digest('hex') })

    await executeClaimed(pg.pool, work, config)

    const terminalWrites = pg.finished.filter(({ sql }) => sql.includes('UPDATE operations SET status=$1'))
    expect(terminalWrites).toHaveLength(1)
    expect(terminalWrites[0].values?.[0]).toBe('failed')
    expect(terminalWrites[0].values?.[1]).toBe('preflight')
    expect(terminalWrites[0].values?.[2]).toMatchObject({
      status: 'conflict', stage: 'preflight', error: { code: 'docker_context_unavailable' },
    })
    expect((await readFile(dockerCalls, 'utf8')).trim().split('\n')).toEqual(['context inspect'])
    expect(terminalWrites[0].values?.[2]).not.toMatchObject({ code: 'worker_error' })
    expect(pg.finished.some(({ sql, values }) => sql.includes('UPDATE operations SET status=$1') && values?.[1] === 'worker_error')).toBe(false)
    expect(pg.finished.filter(({ sql }) => sql === 'BEGIN')).toHaveLength(1)
    expect(pg.finished.filter(({ sql }) => sql === 'COMMIT')).toHaveLength(1)
    expect(pg.finished.filter(({ sql }) => sql === 'ROLLBACK')).toHaveLength(0)
    expect(pg.transactionOpen).toBe(false)
    expect(pg.tenantUpdates.some(({ sql }) => sql.includes("SET status='active'"))).toBe(false)
    expect(pg.tenantUpdates.some(({ sql }) => sql.includes("SET status='registered'"))).toBe(true)
    expect(pg.tenantUpdates.some(({ sql }) => sql.includes("SET status='needs_intervention'"))).toBe(false)
  })
})
