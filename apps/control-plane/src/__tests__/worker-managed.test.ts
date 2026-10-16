import { createHash, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Pool, PoolClient } from 'pg'
import type { Config } from '../config.js'
import { executeClaimed, type Claimed, type OperatorInvocation } from '../worker.js'
import { hasUnresolvedMutation, isScratchDeploymentExemption } from '../db.js'
import { vendorActorIssuer } from '../admin-auth/grants.js'

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
  fixture = await mkdtemp(join(tmpdir(), 'webvue-worker-managed-'))
  const classificationPath = join(fixture, 'classification.json')
  const inventoryPath = join(fixture, 'inventory.json')
  const managedInventoryPath = join(fixture, 'managed.json')
  const digest = `sha256:${'a'.repeat(64)}`
  const descriptor = { adapter: { kind: 'compose-local', version: 1 }, allowed_operations: ['tenant.create'], commercial_mode: 'saas', environment_id: 'env-a',
    release_ref: { catalog_version: 'release-a', catalog_sha256: digest, identity_kind: 'image_id', odoo_image: digest, web_image: digest, proxy_image: digest },
    resource_refs: { project: 'managed-fixture', compose_file: join(fixture, 'compose.yml'), db_name: 'webvue_scratch_managed_fixture', data_dir: join(fixture, 'data'), backup_root: join(fixture, 'backups'), ports: { db: 55433, odoo: 18169, web: 13130 } },
    revision: 1, secret_refs: { db_password: 'db-handle', admin_password: 'admin-handle' } }
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
    operation: { id: randomUUID(), tenant_id: tenantId, actor_uid: 7, issuer: vendorActorIssuer('test'), type, request_id: requestId, reason: 'unit test', payload, status: 'running' },
    tenant: { id: tenantId, inventory_target: type === 'scratch-health' ? 'scratch' : target, commercial_mode: type === 'scratch-health' ? 'saas' : commercialMode, catalog_version: 'catalog-v1', catalog_tier: 'core' },
  }
}

function fakePool(claim: Claimed, catalog?: unknown): Pool & { finishQueries: Array<{ sql: string; values?: unknown[] }> } {
  const finishQueries: Array<{ sql: string; values?: unknown[] }> = []
  const client = { query: vi.fn(async (sql: string, values?: unknown[]) => { finishQueries.push({ sql, values }); return { rowCount: 1, rows: [] } }), release: vi.fn() }
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('FROM vendor_accounts WHERE id')) return { rowCount: 1, rows: [{}] }
    if (sql.includes('FROM vendor_account_roles')) return { rowCount: 1, rows: [{ role: 'operations' }] }
    if (sql.includes('SELECT inventory_target,commercial_mode,operations_enabled')) return { rowCount: 1, rows: [{ inventory_target: claim.tenant.inventory_target, commercial_mode: claim.tenant.commercial_mode, operations_enabled: true }] }
    if (sql.includes('catalog_entries')) return { rowCount: 1, rows: [catalog] }
    if (sql.includes("status='needs_intervention'")) return { rowCount: 0, rows: [] }
    return { rowCount: 1, rows: [] }
  })
  return { query, connect: vi.fn(async () => client), finishQueries } as unknown as Pool & { finishQueries: Array<{ sql: string; values?: unknown[] }> }
}

const basicReceipt = (operation: string, extras: Record<string, unknown> = {}) => ({ schema_version: 1, status: 'ok', target, operation, request_id: requestId, ...extras })

// journal.payload_digest includes the full enrolled descriptor (including its digest),
// unlike the descriptor fingerprint itself. Policy JSON must not be reserialized.
function journalDigest(invocation: OperatorInvocation, policyBytes = invocation.policyBytes!): string {
  const enrollment = JSON.parse(invocation.descriptorBytes!.toString())
  enrollment.descriptor.descriptor_digest = invocation.fingerprint
  const hash = createHash('sha256').update(canonical({ operation: invocation.operation, request_id: invocation.requestId, target: invocation.target }))
  hash.update('\0target\0').update(invocation.fingerprint!)
  for (const bytes of [policyBytes, Buffer.from(canonical(enrollment))]) {
    const length = Buffer.alloc(8)
    length.writeBigUInt64BE(BigInt(bytes.length))
    hash.update('\0file\0').update(length).update(bytes)
  }
  return hash.digest('hex')
}

function verifiedReceipt(invocation: OperatorInvocation): Record<string, unknown> {
  const policy = JSON.parse(invocation.policyBytes!.toString())
  return basicReceipt('tenant.create', {
    operation_id: operationId, stage: 'provisioned', deployment_ready: true, policy_verified: true,
    policy_revision: 1, digest: journalDigest(invocation), fingerprint: invocation.fingerprint,
    profile: { commercial_mode: 'saas', entitlement_source: 'control_plane', policy_revision: 1,
      status: 'active', valid_until: null, features: policy.features, modules: [...policy.modules, 'base', 'web'] },
    expected_modules: [...policy.modules],
  })
}

function returnedProfile(receipt: Record<string, unknown>) {
  return receipt.profile as { features: Record<string, unknown>; modules: unknown; commercial_mode: string; entitlement_source: string; policy_revision: unknown }
}

async function publishedCatalog() {
  const source = await readFile(join(repo, 'deploy/catalog/solutions/platform.json'))
  return { solution: JSON.parse(source.toString()), source_sha256: createHash('sha256').update(source).digest('hex') }
}

function terminal(pool: ReturnType<typeof fakePool>) {
  return pool.finishQueries.find(({ sql }) => sql.includes('UPDATE operations SET status=$1'))!.values!
}

function expectNotActivated(pool: ReturnType<typeof fakePool>) {
  expect(pool.finishQueries.some(({ sql }) => sql.includes("SET status='active'") || sql.includes('observed_policy=desired_policy'))).toBe(false)
}

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
  it('activates only from the durable verified matching create profile, not the immediate response', async () => {
    const claim = fakeClaim('tenant.create')
    const calls: OperatorInvocation[] = []
    const config = await managedConfig(async (invocation) => {
      calls.push(invocation)
      return { code: 0, receipt: calls.length === 1
        ? basicReceipt('tenant.create', { operation_id: operationId }) : verifiedReceipt(invocation) }
    })
    const pool = fakePool(claim, await publishedCatalog())
    await executeClaimed(pool, claim, config)
    expect(calls).toHaveLength(2)
    expect(terminal(pool).slice(0, 2)).toEqual(['succeeded', 'provisioned'])
    expect(terminal(pool)[2]).toMatchObject({ policy_verified: true, deployment_ready: true, policy_revision: 1, _control_lane: 'managed' })
    expect(terminal(pool)[2]).not.toHaveProperty('profile')
    expect(pool.finishQueries.some(({ sql }) => sql.includes("SET status='active'"))).toBe(true)
    const expectedFeatures = JSON.parse(calls[0].policyBytes!.toString()).features
    expect(pool.finishQueries.find(({ sql }) => sql.includes('SET desired_policy=$1'))?.values?.[0]).toEqual(expectedFeatures)
    expect(pool.finishQueries.find(({ sql }) => sql.includes('SET policy_revision=$1'))?.values?.[0]).toBe(1)
    expect(pool.query).toHaveBeenCalledTimes(5) // grant (account, roles), fresh tenant, unresolved mutations, catalog once
  })

  it.each([
    ['absent profile', (r: Record<string, unknown>) => { delete r.profile }],
    ['wrong features', (r: Record<string, unknown>) => { returnedProfile(r).features['users.limit'] = 10 }],
    ['extra features', (r: Record<string, unknown>) => { returnedProfile(r).features['unexpected.enabled'] = true }],
    ['wrong mode', (r: Record<string, unknown>) => { returnedProfile(r).commercial_mode = 'non_saas' }],
    ['wrong source', (r: Record<string, unknown>) => { returnedProfile(r).entitlement_source = 'local_policy' }],
    ['invalid revision', (r: Record<string, unknown>) => { returnedProfile(r).policy_revision = -1 }],
    ['uninitialized revision', (r: Record<string, unknown>) => { returnedProfile(r).policy_revision = 0; r.policy_revision = 0 }],
    ['revision disagreement', (r: Record<string, unknown>) => { r.policy_revision = 2 }],
    ['missing module', (r: Record<string, unknown>) => { (returnedProfile(r).modules as string[]).shift() }],
    ['extra WEBVUE module', (r: Record<string, unknown>) => { (returnedProfile(r).modules as string[]).push('webvue_unselected') }],
    ['duplicate module', (r: Record<string, unknown>) => { (returnedProfile(r).modules as string[]).push('webvue_core') }],
    ['malformed modules', (r: Record<string, unknown>) => { returnedProfile(r).modules = 'webvue_core' }],
    ['missing expected modules', (r: Record<string, unknown>) => { delete r.expected_modules }],
    ['expected modules without a policy module', (r: Record<string, unknown>) => { r.expected_modules = (r.expected_modules as string[]).filter(name => name !== 'webvue_api') }],
    ['non-WebVue expected module', (r: Record<string, unknown>) => { r.expected_modules = [...(r.expected_modules as string[]), 'web'] }],
  ])('rejects truth flags with %s in the durable receipt', async (_name, corrupt) => {
    const claim = fakeClaim('tenant.create')
    const config = await managedConfig(async (invocation) => {
      const receipt = verifiedReceipt(invocation)
      if (invocation.args[0] === 'status') corrupt(receipt)
      return { code: 0, receipt }
    })
    const pool = fakePool(claim, await publishedCatalog())
    await executeClaimed(pool, claim, config)
    expect(terminal(pool)[0]).toBe('needs_intervention')
    expect(terminal(pool)[2]).toMatchObject({ policy_verified: false, deployment_ready: false })
    expect(pool.finishQueries.some(({ sql }) => sql.includes('SET policy_revision=$1') || sql.includes('health_checked_at=now()'))).toBe(false)
    expectNotActivated(pool)
  })

  it('accepts the installation closure the Python readback reports (implied services and bridges)', async () => {
    const claim = fakeClaim('tenant.create')
    const config = await managedConfig(async (invocation) => {
      const receipt = verifiedReceipt(invocation)
      if (invocation.args[0] === 'status') {
        ;(returnedProfile(receipt).modules as string[]).push('webvue_notify')
        receipt.expected_modules = [...(receipt.expected_modules as string[]), 'webvue_notify']
      }
      return { code: 0, receipt }
    })
    const pool = fakePool(claim, await publishedCatalog())
    await executeClaimed(pool, claim, config)
    expect(terminal(pool).slice(0, 2)).toEqual(['succeeded', 'provisioned'])
  })

  it.each(['target', 'request_id', 'operation_id', 'fingerprint', 'digest', 'policy bytes'])('quarantines a durable %s mismatch even with verified flags and matching profile', async (field) => {
    const claim = fakeClaim('tenant.create')
    const config = await managedConfig(async (invocation) => {
      const receipt = verifiedReceipt(invocation)
      if (invocation.args[0] === 'status') {
        if (field === 'policy bytes') receipt.digest = journalDigest(invocation, Buffer.concat([invocation.policyBytes!, Buffer.from('\n')]))
        else receipt[field] = { target: 'tgt_other', request_id: randomUUID(), operation_id: `op_${'b'.repeat(32)}`, fingerprint: `sha256:${'b'.repeat(64)}`, digest: 'b'.repeat(64) }[field]
      }
      return { code: 0, receipt }
    })
    const pool = fakePool(claim, await publishedCatalog())
    await executeClaimed(pool, claim, config)
    expect(terminal(pool).slice(0, 2)).toEqual(['needs_intervention', 'receipt_unverified'])
    expectNotActivated(pool)
  })

  it.each(['deployment_ready', 'policy_verified'])('does not reuse immediate true %s when durable verification is incomplete', async (flag) => {
    const claim = fakeClaim('tenant.create')
    const config = await managedConfig(async (invocation) => {
      const receipt = verifiedReceipt(invocation)
      if (invocation.args[0] === 'status') receipt[flag] = false
      return { code: 0, receipt }
    })
    const pool = fakePool(claim, await publishedCatalog())
    await executeClaimed(pool, claim, config)
    expect(terminal(pool).slice(0, 2)).toEqual(['needs_intervention', 'deployment_incomplete'])
    expectNotActivated(pool)
  })

  it('accepts a journal digest computed by Python over the identical request and policy bytes', async () => {
    const claim = fakeClaim('tenant.create')
    const config = await managedConfig(async (invocation) => {
      const receipt = verifiedReceipt(invocation)
      if (invocation.args[0] === 'status') {
        const enrollment = JSON.parse(invocation.descriptorBytes!.toString())
        enrollment.descriptor.descriptor_digest = invocation.fingerprint
        const digest = spawnSync('python3', ['-B', '-c', [
          'import base64,json,sys',
          'from webvue_cli.journal import payload_digest',
          'd=json.load(sys.stdin)',
          'descriptor=json.dumps(d["descriptor"],sort_keys=True,separators=(",",":"),ensure_ascii=False).encode()',
          'print(payload_digest(d["fields"],[base64.b64decode(d["policy"]),descriptor],d["fingerprint"]))',
        ].join(';')], { cwd: repo, encoding: 'utf8', timeout: 10000,
          env: { ...process.env, PYTHONPATH: join(repo, 'tools') },
          input: JSON.stringify({ fields: { operation: 'tenant.create', target, request_id: requestId },
            descriptor: enrollment, policy: invocation.policyBytes!.toString('base64'), fingerprint: invocation.fingerprint }) })
        expect(digest.status).toBe(0)
        expect(digest.stderr).toBe('')
        receipt.digest = digest.stdout.trim()
      }
      return { code: 0, receipt }
    })
    const pool = fakePool(claim, await publishedCatalog())
    await executeClaimed(pool, claim, config)
    expect(terminal(pool)[0]).toBe('succeeded')
  })

  it('rejects a verified profile without the required modules evidence', async () => {
    const claim = fakeClaim('tenant.create')
    const config = await managedConfig(async (invocation) => {
      const receipt = verifiedReceipt(invocation)
      delete (receipt.profile as Record<string, unknown>).modules
      return { code: 0, receipt }
    })
    const pool = fakePool(claim, await publishedCatalog())
    await executeClaimed(pool, claim, config)
    expect(terminal(pool).slice(0, 2)).toEqual(['needs_intervention', 'deployment_incomplete'])
    expect(terminal(pool)[2]).toMatchObject({ deployment_ready: false, policy_verified: false })
    expectNotActivated(pool)
  })

  it('preserves the incomplete scratch create exemption and its observed policy', async () => {
    const claim = fakeClaim('tenant.create')
    claim.tenant.inventory_target = 'scratch'
    const calls: OperatorInvocation[] = []
    const config = await managedConfig(async (invocation) => {
      calls.push(invocation)
      return { code: 0, receipt: basicReceipt('tenant.create', { target: 'scratch', operation_id: operationId,
        policy_verified: true, deployment_ready: false, policy_revision: 1 }) }
    })
    const pool = fakePool(claim, await publishedCatalog())
    await executeClaimed(pool, claim, config)
    expect(calls.map(({ moduleName }) => moduleName)).toEqual(['webvue_cli.operator', 'webvue_cli.operator'])
    expect(terminal(pool).slice(0, 2)).toEqual(['needs_intervention', 'deployment_incomplete'])
    expect(isScratchDeploymentExemption(terminal(pool)[2] as Record<string, unknown>)).toBe(true)
    expect(pool.finishQueries.find(({ sql }) => sql.includes('SET observed_policy=$1'))?.values?.[0]).toEqual(JSON.parse(calls[0].policyBytes!.toString()).features)
    expectNotActivated(pool)
  })

  it('returns a managed create to registered after a proven effect-free port preflight refusal', async () => {
    const claim = fakeClaim('tenant.create')
    const config = await managedConfig(async () => ({ code: 4, receipt: basicReceipt('tenant.create', {
      status: 'conflict', stage: 'preflight', changed: false, error: { code: 'port_shared' },
    }) }))
    const pool = fakePool(claim, await publishedCatalog())
    await executeClaimed(pool, claim, config)
    expect(terminal(pool)[0]).toBe('failed')
    expect(pool.finishQueries.some(({ sql }) => sql.includes("SET status='registered'"))).toBe(true)
    expect(pool.finishQueries.some(({ sql }) => sql.includes("SET status='needs_intervention'") || sql.includes("SET status='active'"))).toBe(false)
  })

  it.each(['database_exists', 'project_shared', 'volume_shared', 'network_shared', 'image_identity_untrusted', 'catalog_digest_mismatch'])('recovers registered state only from effect-free %s refusal', async (code) => {
    const claim = fakeClaim('tenant.create')
    const config = await managedConfig(async () => ({ code: 4, receipt: basicReceipt('tenant.create', {
      status: 'conflict', stage: 'preflight', changed: false, error: { code },
    }) }))
    const pool = fakePool(claim, await publishedCatalog())
    await executeClaimed(pool, claim, config)
    expect(terminal(pool)[0]).toBe('failed')
    expect(pool.finishQueries.some(({ sql }) => sql.includes("SET status='registered'"))).toBe(true)
    expectNotActivated(pool)
  })

  it.each(['target', 'request_id', 'operation', 'schema_version'])('quarantines an effect-free-looking refusal with a wrong %s binding', async (field) => {
    const claim = fakeClaim('tenant.create')
    const config = await managedConfig(async () => ({ code: 4, receipt: basicReceipt('tenant.create', {
      status: 'conflict', stage: 'preflight', changed: false, error: { code: 'port_shared' },
      [field]: { target: 'tgt_unrelated', request_id: randomUUID(), operation: 'tenant.inspect', schema_version: 2 }[field],
    }) }))
    const pool = fakePool(claim, await publishedCatalog())
    await executeClaimed(pool, claim, config)
    expect(terminal(pool)[0]).toBe('needs_intervention')
    expect(pool.finishQueries.some(({ sql }) => sql.includes("SET status='registered'"))).toBe(false)
  })

  it.each(['unrecognized_error', 'secret_unavailable'])('does not assert retryability for unrecognized %s', async (code) => {
    const claim = fakeClaim('tenant.create')
    const config = await managedConfig(async () => ({ code: 4, receipt: basicReceipt('tenant.create', {
      status: 'conflict', stage: 'preflight', changed: false, error: { code },
    }) }))
    const pool = fakePool(claim, await publishedCatalog())
    await executeClaimed(pool, claim, config)
    expect(terminal(pool)[0]).toBe('needs_intervention')
    expect(pool.finishQueries.some(({ sql }) => sql.includes("SET status='needs_intervention'"))).toBe(true)
    expect(pool.finishQueries.some(({ sql }) => sql.includes("SET status='registered'"))).toBe(false)
    expectNotActivated(pool)
  })

  it('keeps changed or uncertain managed create failures in intervention, not registered', async () => {
    const claim = fakeClaim('tenant.create')
    const config = await managedConfig(async () => ({ code: 6, receipt: basicReceipt('tenant.create', {
      status: 'needs_intervention', stage: 'health', changed: true, error: { code: 'health_unverified' },
    }) }))
    const pool = fakePool(claim, await publishedCatalog())
    await executeClaimed(pool, claim, config)
    expect(terminal(pool)[0]).toBe('needs_intervention')
    expect(pool.finishQueries.some(({ sql }) => sql.includes("SET status='needs_intervention'"))).toBe(true)
    expect(pool.finishQueries.some(({ sql }) => sql.includes("SET status='registered'"))).toBe(false)
  })

  it.each([true, false])('managed inspect uses a safe profile only, without create activation (profile=%s)', async (withProfile) => {
    const claim = fakeClaim('tenant.inspect')
    const features = { 'users.limit': null, 'storage.limit_mb': null }
    const config = await managedConfig(async (invocation) => ({ code: 0, receipt: basicReceipt('tenant.inspect', withProfile
      ? { policy_verified: true, fingerprint: invocation.fingerprint, profile: { commercial_mode: 'saas', entitlement_source: 'control_plane', policy_revision: 1, features } } : {}) }))
    const pool = fakePool(claim)
    await executeClaimed(pool, claim, config)
    expect(terminal(pool)[0]).toBe(withProfile ? 'succeeded' : 'failed')
    expect(pool.finishQueries.some(({ sql }) => sql.includes('SET observed_policy=$1'))).toBe(withProfile)
    expectNotActivated(pool)
  })

  it.each([
    ['missing inspect proof', {}],
    ['wrong inspect fingerprint', { policy_verified: true, fingerprint: `sha256:${'f'.repeat(64)}` }],
  ])('does not accept a managed inspect profile with %s', async (_label, response) => {
    const claim = fakeClaim('tenant.inspect')
    const config = await managedConfig(async () => ({ code: 0, receipt: basicReceipt('tenant.inspect', {
      profile: { commercial_mode: 'saas', entitlement_source: 'control_plane', policy_revision: 1, features: { 'users.limit': null, 'storage.limit_mb': null } },
      ...response,
    }) }))
    const pool = fakePool(claim)
    await executeClaimed(pool, claim, config)
    expect(terminal(pool)[0]).toBe('failed')
    expect(pool.finishQueries.some(({ sql }) => sql.includes('SET observed_policy=$1'))).toBe(false)
  })

  it.each([
    ['missing health proof', {}],
    ['missing profile', { health_verified: true, policy_verified: true }],
    ['wrong fingerprint', { health_verified: true, policy_verified: true, fingerprint: `sha256:${'e'.repeat(64)}`, profile: { commercial_mode: 'saas', entitlement_source: 'control_plane', policy_revision: 1, features: { 'users.limit': null, 'storage.limit_mb': null } } }],
  ])('does not record a managed health success from %s', async (_label, response) => {
    const claim = fakeClaim('health')
    const config = await managedConfig(async () => ({ code: 0, receipt: basicReceipt('health', response) }))
    const pool = fakePool(claim)
    await executeClaimed(pool, claim, config)
    expect(terminal(pool)[0]).toBe('failed')
    expect(pool.finishQueries.some(({ sql }) => sql.includes('health_checked_at=now()'))).toBe(false)
  })

  it('accepts only a bound current managed health observation without activating tenant create', async () => {
    const claim = fakeClaim('health')
    const config = await managedConfig(async (invocation) => ({ code: 0, receipt: basicReceipt('health', {
      health_verified: true, policy_verified: true, fingerprint: invocation.fingerprint,
      profile: { commercial_mode: 'saas', entitlement_source: 'control_plane', policy_revision: 1, features: { 'users.limit': null, 'storage.limit_mb': null } },
    }) }))
    const pool = fakePool(claim)
    await executeClaimed(pool, claim, config)
    expect(terminal(pool)[0]).toBe('succeeded')
    expect(pool.finishQueries.some(({ sql }) => sql.includes('health_checked_at=now()'))).toBe(true)
    expectNotActivated(pool)
  })

  it('a bound verified status lookup does not replay creation or activate the tenant', async () => {
    const policy = { schema_version: 1, channel: 'control_plane', modules: ['webvue_core'], features: { 'users.limit': null, 'storage.limit_mb': null } }
    const claim = fakeClaim('status', 'saas', { operation: 'tenant.create', receipt_request_id: requestId, operation_id: operationId, policy_bytes: JSON.stringify(policy) })
    const calls: OperatorInvocation[] = []
    const config = await managedConfig(async (invocation) => { calls.push(invocation); return { code: 0, receipt: verifiedReceipt(invocation) } })
    const pool = fakePool(claim)
    await executeClaimed(pool, claim, config)
    expect(calls).toHaveLength(1)
    expect(calls[0].args[0]).toBe('status')
    // Status is a journal-only lookup: the bound create receipt succeeds without
    // granting it create activation or policy/health reconciliation authority.
    expect(terminal(pool).slice(0, 2)).toEqual(['succeeded', 'provisioned'])
    expect(pool.finishQueries.some(({ sql }) => sql.includes('SET desired_policy=$1') || sql.includes('SET observed_policy=$1') || sql.includes('health_checked_at=now()') || sql.includes("SET status='active'"))).toBe(false)
    expectNotActivated(pool)
  })

  it.each(['digest', 'fingerprint', 'request_id', 'operation'])('rejects a status receipt with invalid %s binding', async (field) => {
    const claim = fakeClaim('status', 'saas', { operation: 'tenant.create', receipt_request_id: requestId, operation_id: operationId,
      policy_bytes: JSON.stringify({ schema_version: 1, channel: 'control_plane', modules: ['webvue_core'], features: { 'users.limit': null, 'storage.limit_mb': null } }) })
    const config = await managedConfig(async (invocation) => {
      const receipt = verifiedReceipt(invocation)
      receipt[field] = { digest: 'b'.repeat(64), fingerprint: `sha256:${'b'.repeat(64)}`, request_id: randomUUID(), operation: 'tenant.inspect' }[field]
      return { code: 0, receipt }
    })
    const pool = fakePool(claim)
    await executeClaimed(pool, claim, config)
    expect(terminal(pool).slice(0, 2)).toEqual(['needs_intervention', 'receipt_unverified'])
    expect(pool.finishQueries.some(({ sql }) => sql.includes('SET desired_policy=$1') || sql.includes('SET observed_policy=$1') || sql.includes('health_checked_at=now()') || sql.includes("SET status='active'"))).toBe(false)
    expectNotActivated(pool)
  })

  it('keeps scratch operations on webvue_cli.operator', async () => {
    const calls: OperatorInvocation[] = []
    const claim = fakeClaim('health', 'saas')
    claim.tenant.inventory_target = 'scratch'
    const config = await managedConfig(async (invocation) => { calls.push(invocation); return { code: 0, receipt: { schema_version: 1, status: 'ok', target: 'scratch', operation: 'health' } } })
    const classificationPath = join(fixture!, 'classification.json')
    await writeFile(classificationPath, JSON.stringify({ schema_version: 1, database: 'scratch_db', commercial_mode: 'saas', entitlement_source: 'control_plane' }))
    await writeFile(config.inventoryPath, JSON.stringify({ version: 2, targets: { scratch: { kind: 'scratch', database: 'scratch_db', classification_file: classificationPath } } }))
    await executeClaimed(fakePool(claim), claim, config)
    expect(calls[0].moduleName).toBe('webvue_cli.operator')
    expect(calls[0].env.WEBVUE_CLI_INVENTORY).toBe(config.inventoryPath)
    expect(calls[0].env.WEBVUE_MANAGED_INVENTORY).toBeUndefined()
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
        : { code: 0, receipt: basicReceipt('tenant.create', { operation_id: operationId, deployment_ready: false, policy_verified: false, digest: journalDigest(invocation), fingerprint: invocation.fingerprint }) }
    })
    const pool = fakePool(claim, { solution, source_sha256: createHash('sha256').update(catalogSource).digest('hex') })
    await executeClaimed(pool, claim, config)
    expect(calls).toHaveLength(2)
    expect(calls.map((call) => call.moduleName)).toEqual(['webvue_cli.managed_runtime', 'webvue_cli.managed_runtime'])
    expect(calls[1].args).toContain('--policy-bytes-file')
    expect(calls[0].policyBytes?.equals(calls[1].policyBytes ?? Buffer.alloc(0))).toBe(true)
    expect(calls[0].env.WEBVUE_MANAGED_INVENTORY).toBe(config.managedInventoryPath)
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
    const config = await managedConfig(async (invocation) => { calls.push(invocation); return { code: 0, receipt: basicReceipt('tenant.create', { operation_id: operationId, deployment_ready: true, policy_verified: false, digest: journalDigest(invocation), fingerprint: invocation.fingerprint }) } })
    const pool = fakePool(claim)
    await executeClaimed(pool, claim, config)
    expect(calls).toHaveLength(1)
    expect(calls[0].moduleName).toBe('webvue_cli.managed_runtime')
    expect(calls[0].args).toContain('--policy-bytes-file')
    expect(calls[0].policyBytes?.toString()).toBe('{"schema_version":1,"channel":"control_plane"}')
    expect(pool.finishQueries.some(({ sql, values }) => sql.includes('UPDATE operations SET status=$1') && values?.[0] === 'succeeded')).toBe(true)
    expect(pool.finishQueries.some(({ sql }) => sql.includes("SET status='active'") || sql.includes('SET desired_policy=$1') || sql.includes('SET observed_policy=$1') || sql.includes('health_checked_at=now()'))).toBe(false)
  })

  it('does not route managed health into a create-completion path', async () => {
    const calls: OperatorInvocation[] = []
    const claim = fakeClaim('health')
    const config = await managedConfig(async (invocation) => { calls.push(invocation); return { code: 0, receipt: basicReceipt('health') } })
    const pool = fakePool(claim)
    await executeClaimed(pool, claim, config)
    expect(calls).toHaveLength(1)
    expect(calls[0].moduleName).toBe('webvue_cli.managed_runtime')
    expect(pool.finishQueries.some(({ sql }) => sql.includes("SET status='active'") || sql.includes('observed_policy=desired_policy'))).toBe(false)
  })
})
