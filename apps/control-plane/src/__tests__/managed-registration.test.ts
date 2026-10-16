import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { signMock as signServiceRequest, mockSessionQuery } from './helpers/vendor-session.js'
import { createApp } from '../http.js'

type Tenant = Record<string, unknown>

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function descriptor(target: string, overrides: Record<string, unknown> = {}) {
  const base = {
    adapter: { kind: 'compose-local', version: 1 },
    allowed_operations: ['tenant.create', 'tenant.inspect', 'health', 'tenant.preflight'],
    commercial_mode: 'saas',
    release_ref: { catalog_version: 'test-v1', catalog_sha256: `sha256:${'a'.repeat(64)}`, identity_kind: 'image_id', odoo_image: `sha256:${'b'.repeat(64)}`, web_image: `sha256:${'c'.repeat(64)}`, proxy_image: `sha256:${'d'.repeat(64)}` },
    resource_refs: { project: 'managed-fixture', compose_file: '/tmp/managed-fixture/compose.yml', db_name: 'webvue_scratch_managed_fixture', data_dir: '/tmp/managed-fixture/data', backup_root: '/tmp/managed-fixture/backups', ports: { db: 55433, odoo: 18169, web: 13130 } },
    revision: 1,
    secret_refs: { db_password: 'secret-handle-db', admin_password: 'secret-handle-admin' },
    environment_id: 'managed-fixture',
    ...overrides,
  }
  const bytes = Buffer.from(canonicalJson({ target, descriptor: base }), 'utf8')
  return { ...base, descriptor_digest: (overrides.descriptor_digest as string | undefined) ?? `sha256:${createHash('sha256').update(bytes).digest('hex')}` }
}

describe('managed registration HTTP slice', () => {
  const key = 'managed-registration-test-key-'.repeat(2)
  const config = { installationId: 'vendor-fixture', key, inventoryPath: '', managedInventoryPath: '', stateDir: '/private/state/path', repositoryRoot: '/private/repo/path', python: 'python3' }
  const tenants: Tenant[] = []
  const catalogs: Array<{ version: string; sha: string; tiers: string[] }> = []
  const queries: string[] = []
  beforeEach(() => { queries.length = 0 })
  const client = {
    async query(sql: string, params: unknown[] = []) {
      queries.push(sql)
      const session = mockSessionQuery(sql, params)
      if (session) return session
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rowCount: 0, rows: [] }
      if (sql.startsWith('DELETE FROM service_nonces')) return { rowCount: 0, rows: [] }
      if (sql.startsWith('INSERT INTO service_nonces')) return { rowCount: 1, rows: [{ nonce: 'fresh' }] }
      if (sql.startsWith('SELECT 1 FROM vendor_accounts WHERE id')) return { rowCount: 1, rows: [{}] }
      if (sql.startsWith('SELECT role FROM vendor_account_roles')) return { rowCount: 2, rows: [{ role: 'customer_success' }, { role: 'operations' }] }
      if (sql.startsWith('SELECT solution,source_sha256 FROM catalog_entries')) {
        const catalog = catalogs.find((item) => item.version === params[0])
        return catalog ? { rowCount: 1, rows: [{ source_sha256: catalog.sha, solution: { tiers: catalog.tiers.map((id) => ({ id })) } }] } : { rowCount: 0, rows: [] }
      }
      if (sql.startsWith('SELECT solution FROM catalog_entries')) {
        const catalog = catalogs.find((item) => item.version === params[0])
        return catalog ? { rowCount: 1, rows: [{ solution: { tiers: catalog.tiers.map((id) => ({ id })) } }] } : { rowCount: 0, rows: [] }
      }
      if (sql.startsWith('SELECT id,name,commercial_mode,hosting_model,inventory_target') && sql.includes('FROM tenants WHERE id=')) {
        const tenant = tenants.find((item) => item.id === params[0])
        return tenant ? { rowCount: 1, rows: [tenant] } : { rowCount: 0, rows: [] }
      }
      if (sql.startsWith('SELECT * FROM tenants')) {
        const tenant = tenants.find((item) => item.id === params[0])
        return tenant ? { rowCount: 1, rows: [tenant] } : { rowCount: 0, rows: [] }
      }
      if (sql.startsWith('SELECT') && sql.includes('FROM operations WHERE request_id=')) return { rowCount: 0, rows: [] }
      if (sql.startsWith('SELECT 1 FROM operations')) return { rowCount: 0, rows: [] }
      if (sql.startsWith('INSERT INTO operations')) return { rowCount: 1, rows: [{ id: randomUUID(), status: 'queued', type: 'tenant.create' }] }
      if (sql.startsWith('INSERT INTO operation_events')) return { rowCount: 1, rows: [] }
      if (sql.startsWith('UPDATE tenants SET operations_enabled=')) {
        const tenant = tenants.find((item) => item.id === params[1])
        if (!tenant) return { rowCount: 0, rows: [] }
        tenant.operations_enabled = params[0]
        return { rowCount: 1, rows: [tenant] }
      }
      if (sql.startsWith('UPDATE tenants SET status=')) return { rowCount: 1, rows: [] }
      if (sql.startsWith('INSERT INTO tenants')) {
        const row = { id: randomUUID(), name: params[1], commercial_mode: params[2], hosting_model: params[3], inventory_target: params[4], catalog_version: params[5], catalog_tier: params[6], status: 'registered', operations_enabled: params[7] }
        tenants.push(row)
        return { rowCount: 1, rows: [row] }
      }
      if (sql.startsWith('INSERT INTO audit_events')) return { rowCount: 1, rows: [] }
      throw new Error(`Unexpected SQL in fixture: ${sql}`)
    },
    release() {},
  }
  const pool = { connect: async () => client, query: client.query.bind(client) } as unknown as Pool
  let fixtureDir: string
  let server: ReturnType<ReturnType<typeof createApp>['listen']>
  let origin: string

  beforeAll(async () => {
    fixtureDir = await mkdtemp(join(tmpdir(), 'managed-registration-'))
    config.inventoryPath = join(fixtureDir, 'v2.json')
    config.managedInventoryPath = join(fixtureDir, 'v3.json')
    await writeFile(config.inventoryPath, JSON.stringify({ version: 2, targets: { 'legacy-scratch': { kind: 'scratch', database: 'safe_scratch', classification_file: join(fixtureDir, 'classification.json') } } }))
    await writeFile(join(fixtureDir, 'classification.json'), JSON.stringify({ schema_version: 1, database: 'safe_scratch', commercial_mode: 'saas', entitlement_source: 'control_plane' }))
    server = createApp(pool, config).listen(0, '127.0.0.1')
    await new Promise<void>((resolve) => server.once('listening', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('missing address')
    origin = `http://127.0.0.1:${address.port}`
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(fixtureDir, { recursive: true, force: true })
  })

  async function call(method: string, path: string, body = '') {
    const headers = signServiceRequest({ method, path, body, actor: 7, issuer: config.installationId, key })
    return fetch(origin + path, { method, headers: { ...headers, 'content-type': 'application/json' }, body: body || undefined })
  }

  async function setCatalog(version: string, sha = `sha256:${'a'.repeat(64)}`) {
    const existing = catalogs.findIndex((catalog) => catalog.version === version)
    const item = { version, sha: sha.replace(/^sha256:/, ''), tiers: ['core'] }
    if (existing >= 0) catalogs[existing] = item
    else catalogs.push(item)
  }

  async function setInventories(v2: Record<string, unknown>, v3: Record<string, unknown>) {
    await writeFile(config.inventoryPath, JSON.stringify({ version: 2, targets: v2 }))
    await writeFile(config.managedInventoryPath, JSON.stringify({ schema_version: 3, targets: v3 }))
  }

  it('exposes an authorized v3 compose-local target without private descriptor data', async () => {
    const target = 'tgt_managed_local'
    await setInventories({ 'legacy-scratch': { kind: 'scratch', database: 'safe_scratch', classification_file: join(fixtureDir, 'classification.json') } }, { [target]: descriptor(target) })
    const response = await call('GET', '/v1/targets')
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({ items: [{ id: 'legacy-scratch', kind: 'scratch' }, { id: target, kind: 'customer' }], total: 2 })
    expect(JSON.stringify(body)).not.toMatch(/descriptor_digest|resource_refs|secret_refs|stateDir|inventoryPath|private/)
  })

  it('registers a v3 managed target using the authorized compose-local lane', async () => {
    const target = 'tgt_managed_register'
    await setCatalog('test-v1')
    await setInventories({}, { [target]: descriptor(target) })
    const before = tenants.length
    const response = await call('POST', '/v1/tenants', JSON.stringify({ name: 'Managed fixture', commercial_mode: 'saas', hosting_model: 'managed', inventory_target: target, catalog_version: 'test-v1', catalog_tier: 'core', reason: 'Register managed fixture' }))
    expect(response.status).toBe(201)
    expect((await response.json() as Tenant).inventory_target).toBe(target)
    expect(tenants).toHaveLength(before + 1)
  })

  it('rejects managed registration when the selected catalog version or immutable source digest is not bound to the descriptor', async () => {
    const target = 'tgt_managed_catalog_mismatch'
    await setCatalog('other-v1')
    await setCatalog('test-v1', `sha256:${'e'.repeat(64)}`)
    await setInventories({}, { [target]: descriptor(target) })
    const wrongVersion = await call('POST', '/v1/tenants', JSON.stringify({ name: 'Wrong catalog version', commercial_mode: 'saas', hosting_model: 'managed', inventory_target: target, catalog_version: 'other-v1', catalog_tier: 'core', reason: 'Reject mismatched catalog version' }))
    expect(wrongVersion.status).toBe(422)
    expect(await wrongVersion.json()).toMatchObject({ field: 'catalog_version' })
    const wrongDigest = await call('POST', '/v1/tenants', JSON.stringify({ name: 'Wrong catalog source', commercial_mode: 'saas', hosting_model: 'managed', inventory_target: target, catalog_version: 'test-v1', catalog_tier: 'core', reason: 'Reject mismatched catalog source' }))
    expect(wrongDigest.status).toBe(422)
    expect(await wrongDigest.json()).toMatchObject({ field: 'catalog_version' })
    expect(tenants.some((tenant) => tenant.inventory_target === target)).toBe(false)
  })

  it('exposes only server-authorized operations for managed and scratch tenant details', async () => {
    const managedTarget = 'tgt_managed_actions'
    await setInventories({ 'legacy-scratch': { kind: 'scratch', database: 'safe_scratch', classification_file: join(fixtureDir, 'classification.json') } }, { [managedTarget]: descriptor(managedTarget) })
    await setCatalog('test-v1')
    const managed = await call('POST', '/v1/tenants', JSON.stringify({ name: 'Managed actions', commercial_mode: 'saas', hosting_model: 'managed', inventory_target: managedTarget, catalog_version: 'test-v1', catalog_tier: 'core', reason: 'Check actions' }))
    const managedId = (await managed.json() as Tenant).id
    const registered = await call('GET', `/v1/tenants/${managedId}`)
    expect((await registered.json() as Tenant).available_operations).toEqual(['tenant.create'])
    const stored = tenants.find((item) => item.id === managedId)!
    stored.status = 'active'
    const active = await call('GET', `/v1/tenants/${managedId}`)
    expect((await active.json() as Tenant).available_operations).toEqual(['tenant.inspect', 'health'])
    const scratch = await call('POST', '/v1/tenants', JSON.stringify({ name: 'Scratch actions', commercial_mode: 'saas', hosting_model: 'managed', inventory_target: 'legacy-scratch', catalog_version: 'test-v1', catalog_tier: 'core', reason: 'Check scratch' }))
    const scratchId = (await scratch.json() as Tenant).id
    tenants.find((item) => item.id === scratchId)!.status = 'active'
    const scratchDetail = await call('GET', `/v1/tenants/${scratchId}`)
    expect((await scratchDetail.json() as Tenant).available_operations).toEqual(['tenant.inspect', 'health', 'backup', 'tenant.entitle'])
    stored.status = 'needs_intervention'
    const quarantined = await call('GET', `/v1/tenants/${managedId}`)
    expect((await quarantined.json() as Tenant).available_operations).toEqual([])
    stored.status = 'active'
    stored.operations_enabled = false
    const disabled = await call('GET', `/v1/tenants/${managedId}`)
    expect((await disabled.json() as Tenant).available_operations).toEqual([])
  })

  it('does not advertise or enqueue managed inspect/health absent from the descriptor allowlist', async () => {
    const target = 'tgt_create_only_actions'
    await setCatalog('test-v1')
    await setInventories({}, { [target]: descriptor(target, { allowed_operations: ['tenant.create'] }) })
    const registered = await call('POST', '/v1/tenants', JSON.stringify({ name: 'Create only', commercial_mode: 'saas', hosting_model: 'managed', inventory_target: target, catalog_version: 'test-v1', catalog_tier: 'core', reason: 'Check allowlist' }))
    expect(registered.status).toBe(201)
    const id = (await registered.json() as Tenant).id
    tenants.find((item) => item.id === id)!.status = 'active'
    const detail = await call('GET', `/v1/tenants/${id}`)
    expect((await detail.json() as Tenant).available_operations).toEqual([])
    for (const type of ['tenant.inspect', 'health']) {
      const queued = await call('POST', `/v1/tenants/${id}/operations`, JSON.stringify({ type, request_id: randomUUID(), reason: 'Reject disallowed operation' }))
      expect(queued.status).toBe(422)
    }
    expect(queries.some((sql) => sql.startsWith('INSERT INTO operations'))).toBe(false)
  })

  it('does not advertise managed create after published catalog source drifts', async () => {
    const target = 'tgt_managed_drift_actions'
    await setCatalog('test-v1')
    await setInventories({}, { [target]: descriptor(target) })
    const response = await call('POST', '/v1/tenants', JSON.stringify({ name: 'Drift actions', commercial_mode: 'saas', hosting_model: 'managed', inventory_target: target, catalog_version: 'test-v1', catalog_tier: 'core', reason: 'Check drift' }))
    expect(response.status).toBe(201)
    const id = (await response.json() as Tenant).id
    await setCatalog('test-v1', `sha256:${'f'.repeat(64)}`)
    const detail = await call('GET', `/v1/tenants/${id}`)
    expect((await detail.json() as Tenant).available_operations).toEqual([])
  })

  it('does not report a failed grant after its committed tenant update when inventory readback fails', async () => {
    const target = 'tgt_grant_readback'
    await setInventories({}, { [target]: descriptor(target) })
    const registered = await call('POST', '/v1/tenants', JSON.stringify({ name: 'Grant fixture', commercial_mode: 'saas', hosting_model: 'managed', inventory_target: target, reason: 'Grant fixture' }))
    const id = (await registered.json() as Tenant).id
    await writeFile(config.managedInventoryPath, '{not-json')
    const response = await call('POST', `/v1/tenants/${id}/operations-grant`, JSON.stringify({ enabled: true, reason: 'Enable even if inventory is unavailable' }))
    expect(response.status).toBe(200)
    expect((await response.json() as Tenant).operations_enabled).toBe(true)
    expect(tenants.find((item) => item.id === id)?.operations_enabled).toBe(true)
    expect(queries.some((sql) => sql.startsWith('INSERT INTO audit_events'))).toBe(true)
  })

  it('keeps v2 scratch registration compatible', async () => {
    await setInventories({ 'legacy-scratch': { kind: 'scratch', database: 'safe_scratch', classification_file: join(fixtureDir, 'classification.json') } }, {})
    const response = await call('POST', '/v1/tenants', JSON.stringify({ name: 'Legacy fixture', commercial_mode: 'saas', hosting_model: 'managed', inventory_target: 'legacy-scratch', reason: 'Register scratch fixture' }))
    expect(response.status).toBe(201)
  })

  it.each([
    ['wrong mode', 'tgt_wrong_mode', { commercial_mode: 'non_saas' }],
    ['malformed digest', 'tgt_bad_digest', { descriptor_digest: 'sha256:not-a-digest' }],
    ['well-shaped but mismatched digest', 'tgt_mismatched_digest', { descriptor_digest: `sha256:${'0'.repeat(64)}` }],
    ['empty resource references', 'tgt_empty_resources', { resource_refs: {} }],
    ['empty secret references', 'tgt_empty_secrets', { secret_refs: {} }],
    ['incomplete release references', 'tgt_incomplete_release', { release_ref: {} }],
    ['unknown operation', 'tgt_unknown_operation', { allowed_operations: ['tenant.create', 'backup'] }],
    ['unsafe scratch database', 'tgt_unsafe_database', { resource_refs: { ...descriptor('nested').resource_refs as Record<string, unknown>, db_name: 'webvue_scratch_production' } }],
    ['shared reserved port', 'tgt_reserved_port', { resource_refs: { ...descriptor('nested').resource_refs as Record<string, unknown>, ports: { db: 55433, odoo: 8069, web: 13130 } } }],
  ])('rejects a managed descriptor with %s', async (_label, target, overrides) => {
    await setInventories({}, { [target]: descriptor(target, overrides) })
    const response = await call('POST', '/v1/tenants', JSON.stringify({ name: 'Rejected', commercial_mode: 'saas', hosting_model: 'managed', inventory_target: target, reason: 'Reject invalid target' }))
    expect(response.status).toBe(422)
    expect(tenants.some((tenant) => tenant.inventory_target === target)).toBe(false)
  })

  it('revalidates managed catalog binding against current immutable catalog before enqueue', async () => {
    const target = 'tgt_managed_enqueue_catalog'
    await setCatalog('test-v1')
    await setInventories({}, { [target]: descriptor(target) })
    const registered = await call('POST', '/v1/tenants', JSON.stringify({ name: 'Catalog-bound managed', commercial_mode: 'saas', hosting_model: 'managed', inventory_target: target, catalog_version: 'test-v1', catalog_tier: 'core', reason: 'Register catalog-bound managed' }))
    expect(registered.status).toBe(201)
    const tenant = await registered.json() as Tenant
    catalogs.find((item) => item.version === 'test-v1')!.sha = 'f'.repeat(64)
    queries.length = 0
    const enqueued = await call('POST', `/v1/tenants/${tenant.id}/operations`, JSON.stringify({ type: 'tenant.create', request_id: randomUUID(), reason: 'Enqueue managed create' }))
    expect(enqueued.status).toBe(422)
    expect(queries.some((sql) => sql.startsWith('INSERT INTO operations'))).toBe(false)
  })

  it('revalidates the selected version when the managed descriptor changes before enqueue', async () => {
    const target = 'tgt_managed_enqueue_version'
    await setCatalog('test-v1')
    await setInventories({}, { [target]: descriptor(target) })
    const registered = await call('POST', '/v1/tenants', JSON.stringify({ name: 'Version-bound managed', commercial_mode: 'saas', hosting_model: 'managed', inventory_target: target, catalog_version: 'test-v1', catalog_tier: 'core', reason: 'Register version-bound managed' }))
    expect(registered.status).toBe(201)
    const tenant = await registered.json() as Tenant
    await setInventories({}, { [target]: descriptor(target, { release_ref: { ...(descriptor(target).release_ref as Record<string, unknown>), catalog_version: 'other-v1' } }) })
    queries.length = 0
    const enqueued = await call('POST', `/v1/tenants/${tenant.id}/operations`, JSON.stringify({ type: 'tenant.create', request_id: randomUUID(), reason: 'Reject changed release' }))
    expect(enqueued.status).toBe(422)
    expect(queries.some((sql) => sql.startsWith('INSERT INTO operations'))).toBe(false)
  })

  it('enqueues managed create when the published catalog matches the current release', async () => {
    const target = 'tgt_managed_create_match'
    await setCatalog('test-v1')
    await setInventories({}, { [target]: descriptor(target) })
    const registered = await call('POST', '/v1/tenants', JSON.stringify({ name: 'Matching managed', commercial_mode: 'saas', hosting_model: 'managed', inventory_target: target, catalog_version: 'test-v1', catalog_tier: 'core', reason: 'Register matching managed' }))
    expect(registered.status).toBe(201)
    const tenant = await registered.json() as Tenant
    queries.length = 0
    const enqueued = await call('POST', `/v1/tenants/${tenant.id}/operations`, JSON.stringify({ type: 'tenant.create', request_id: randomUUID(), reason: 'Enqueue matching managed' }))
    expect(enqueued.status).toBe(202)
    expect(queries.some((sql) => sql.startsWith('INSERT INTO operations'))).toBe(true)
  })

  it('rejects duplicate target identifiers across v2 and v3 rather than selecting an alias lane', async () => {
    const target = 'tgt_duplicate'
    await setInventories({ [target]: { kind: 'scratch', database: 'safe_scratch', classification_file: join(fixtureDir, 'classification.json') } }, { [target]: descriptor(target) })
    const listed = await call('GET', '/v1/targets')
    const registered = await call('POST', '/v1/tenants', JSON.stringify({ name: 'Duplicate', commercial_mode: 'saas', hosting_model: 'managed', inventory_target: target, reason: 'Reject duplicate target' }))
    expect(listed.status).toBe(503)
    expect(registered.status).toBe(422)
    expect(tenants.some((tenant) => tenant.inventory_target === target)).toBe(false)
  })

  it('preserves non_saas v2 scratch registration while disabling control-plane operations', async () => {
    const classification = join(fixtureDir, 'non-saas-registration.json')
    await writeFile(classification, JSON.stringify({ schema_version: 1, database: 'non_saas_db', commercial_mode: 'non_saas', entitlement_source: 'local_policy' }))
    await setInventories({ 'non-saas-scratch': { kind: 'scratch', database: 'non_saas_db', classification_file: classification } }, {})
    const response = await call('POST', '/v1/tenants', JSON.stringify({ name: 'Legacy non-SaaS', commercial_mode: 'non_saas', hosting_model: 'customer_hosted', inventory_target: 'non-saas-scratch', reason: 'Preserve local registration' }))
    expect(response.status).toBe(201)
    expect((await response.json() as Tenant).operations_enabled).toBe(false)
  })

  it('rejects v2 customer and non_saas targets when they cannot resolve to an allowed registration lane', async () => {
    const classification = join(fixtureDir, 'non-saas.json')
    await writeFile(classification, JSON.stringify({ schema_version: 1, database: 'customer_db', commercial_mode: 'non_saas', entitlement_source: 'local_policy' }))
    await setInventories({ 'legacy-customer': { kind: 'customer', database: 'safe_scratch', classification_file: join(fixtureDir, 'classification.json') }, 'local-install': { kind: 'scratch', database: 'customer_db', classification_file: classification } }, {})
    const customer = await call('POST', '/v1/tenants', JSON.stringify({ name: 'Customer alias', commercial_mode: 'saas', hosting_model: 'managed', inventory_target: 'legacy-customer', reason: 'Reject customer alias' }))
    const nonSaas = await call('POST', '/v1/tenants', JSON.stringify({ name: 'Non SaaS', commercial_mode: 'non_saas', hosting_model: 'customer_hosted', inventory_target: 'local-install', reason: 'Reject local target' }))
    await setInventories({}, { 'tgt_non_saas_managed': descriptor('tgt_non_saas_managed', { commercial_mode: 'non_saas' }) })
    const nonSaasManaged = await call('POST', '/v1/tenants', JSON.stringify({ name: 'Managed non-SaaS', commercial_mode: 'saas', hosting_model: 'managed', inventory_target: 'tgt_non_saas_managed', reason: 'Reject non-SaaS managed descriptor' }))
    expect(customer.status).toBe(422)
    expect(nonSaas.status).toBe(201)
    expect(nonSaasManaged.status).toBe(422)
  })
})
