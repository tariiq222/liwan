// Audit-only reproducer: records current defects, NOT a green acceptance gate.
// Run from this worktree: node_modules/.bin/tsx docs/project-closure/saas-audit-repro.mts
// No server listens. No PostgreSQL, Docker, HTTP request or real secret is used.
// Production handlers/worker/Python adapter run with an in-memory SQL recorder;
// create preflight uses injected observations and an effect runner that throws.
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createApp, resolveTargetLane } from '../../apps/control-plane/src/http.ts'
import { executeClaimed } from '../../apps/control-plane/src/worker.ts'
import { signServiceRequest } from '../../packages/commercial-contracts/src/server.ts'

const repo = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const root = await mkdtemp(join(tmpdir(), 'nasq-readonly-audit-'))
const target = 'tgt_audit_only'
const tenantId = randomUUID()
const requestId = randomUUID()
const canonical = (x: any): string => Array.isArray(x) ? `[${x.map(canonical).join(',')}]`
  : x && typeof x === 'object' ? `{${Object.keys(x).sort().map(k => `${JSON.stringify(k)}:${canonical(x[k])}`).join(',')}}` : JSON.stringify(x)
const queries: Array<{sql: string, values?: any[]}> = []
let tenantStatus = 'registered'
let finished: any[] | undefined
const tenant = { id: tenantId, inventory_target: target, commercial_mode: 'saas', hosting_model: 'managed', catalog_version: 'audit-v1', catalog_tier: 'core', operations_enabled: true }

try {
  const catalogBytes = await readFile(join(repo, 'deploy/catalog/solutions/platform.json'))
  const catalogHash = createHash('sha256').update(catalogBytes).digest('hex')
  const inventoryPath = join(root, 'inventory.json')
  const managedInventoryPath = join(root, 'managed.json')
  const composeFile = join(root, 'compose.json')
  const stateDir = join(root, 'state')
  await mkdir(stateDir, { mode: 0o700 })
  const descriptor: any = {
    adapter: { kind: 'compose-local', version: 1 }, commercial_mode: 'saas', environment_id: 'audit-local',
    resource_refs: { project: 'nasq-audit-local', compose_file: composeFile, db_name: 'nasq_scratch_audit_only', data_dir: join(root, 'data'), backup_root: join(root, 'backups'), ports: { db: 25131, odoo: 25132, web: 25133 } },
    secret_refs: { db_password: 'not-resolved-db', admin_password: 'not-resolved-admin' },
    release_ref: { catalog_version: 'audit-v1', catalog_sha256: `sha256:${catalogHash}`, identity_kind: 'image_id', odoo_image: `sha256:${'a'.repeat(64)}`, web_image: `sha256:${'b'.repeat(64)}`, proxy_image: `sha256:${'c'.repeat(64)}` },
    allowed_operations: ['tenant.create', 'tenant.inspect', 'health'], revision: 1,
  }
  descriptor.descriptor_digest = `sha256:${createHash('sha256').update(canonical({ target, descriptor })).digest('hex')}`
  await writeFile(inventoryPath, JSON.stringify({ version: 2, targets: {} }), { mode: 0o600 })
  await writeFile(managedInventoryPath, JSON.stringify({ schema_version: 3, targets: { [target]: descriptor } }), { mode: 0o600 })
  await writeFile(composeFile, '{"services":{}}', { mode: 0o600 })
  const config: any = { installationId: 'audit-local', key: 'audit-fixture-only-not-a-secret-0000000000', inventoryPath, managedInventoryPath, stateDir, repositoryRoot: repo, python: 'python3' }
  const query = async (sql: string, values?: any[]) => {
    queries.push({sql, values})
    if (sql.includes('vendor_memberships')) return { rowCount: 1, rows: [{ capabilities: ['vendor.read', 'vendor.tenants.manage', 'vendor.operations.run'] }] }
    if (sql.includes('SELECT inventory_target,commercial_mode,operations_enabled')) return { rowCount: 1, rows: [tenant] }
    if (sql.includes('SELECT * FROM tenants')) return { rowCount: 1, rows: [{...tenant, status: tenantStatus}] }
    if (sql.includes('catalog_entries')) return { rowCount: 1, rows: [{ solution: JSON.parse(catalogBytes.toString()), source_sha256: catalogHash }] }
    if (sql.includes("status='needs_intervention'")) return { rowCount: 0, rows: [] }
    if (sql.includes('UPDATE operations SET status=$1')) { finished = values; return { rowCount: 1, rows: [{id: values?.[3]}] } }
    if (sql.startsWith('UPDATE tenants SET status=')) {
      const match = /SET status='([^']+)'/.exec(sql)
      if (match) tenantStatus = match[1]!
    }
    return { rowCount: 1, rows: [{}] }
  }
  const client = { query, release() {} }
  const pool: any = { query, connect: async () => client }
  const app = createApp(pool, config)
  const handler = app.listeners('request')[0] as any
  const call = async (method: string, path: string, data?: unknown) => {
    const body = data === undefined ? '' : JSON.stringify(data)
    const req: any = Readable.from(body ? [Buffer.from(body)] : [])
    req.method = method; req.url = path
    req.headers = signServiceRequest({ method, path, body, actor: 7, issuer: config.installationId, key: config.key })
    let status = 0; let result: any
    const res: any = { writeHead(code: number) { status = code }, end(bytes: string) { result = JSON.parse(bytes) } }
    await handler(req, res)
    return { status, body: result }
  }
  assert.equal((await resolveTargetLane(config, target, 'saas')).kind, 'compose-local')
  const targets = await call('GET', '/v1/targets')
  assert.equal(targets.status, 200)
  assert.equal(targets.body.items.length, 0)
  const registration = await call('POST', '/v1/tenants', { name: 'Audit fixture', commercial_mode: 'saas', hosting_model: 'managed', inventory_target: target, catalog_version: 'audit-v1', catalog_tier: 'core', reason: 'Hermetic audit only' })
  assert.equal(registration.status, 422)
  assert.equal(registration.body.field, 'inventory_target')
  console.log(JSON.stringify({ finding: 'SAAS-01', observed: 'valid managed lane missing from targets; registration rejected', targets: targets.status, registration }))

  const claim = (type: string): any => ({ client, lockKey: target, tenant, operation: { id: randomUUID(), tenant_id: tenantId, actor_uid: 7, issuer: config.installationId, type, request_id: requestId, reason: 'Hermetic audit only', payload: {}, status: 'running' } })
  // These are actual Python managed adapter subprocess reads; no injected adapter.
  for (const type of ['tenant.inspect', 'health']) {
    finished = undefined; queries.length = 0
    await executeClaimed(pool, claim(type), config)
    assert.ok(finished)
    assert.equal(finished![0], 'failed')
    if (type === 'tenant.inspect') {
      assert.equal(finished![1], 'snapshot')
      assert.equal(finished![2].status, 'ok')
    } else assert.equal(finished![2].error.code, 'health_unverified')
    console.log(JSON.stringify({ finding: type === 'health' ? 'SAAS-03' : 'SAAS-02', observed: type, operationStatus: finished![0], stage: finished![1], receipt: finished![2] }))
  }

  // Real Python refusal with injected port occupancy; no executable Docker seam.
  const python = `import json,sys\nfrom nasq_cli.managed_runtime import managed_adapter\nfields=json.loads(sys.argv[1])\ndef forbidden(*args,**kwargs):\n raise AssertionError('effects and secrets forbidden in audit')\ndef probe(kind,value):\n if kind=='catalog_sha256': return sys.argv[2]\n if kind=='image_identity': return value\n if kind=='compose_file': return True\n if kind=='port_in_use': return True\n if kind in ('database_exists','project_exists','volume_exists','network_exists'): return False\n raise AssertionError(kind)\ncode,receipt=managed_adapter(fields,runner=forbidden,probe=probe,resolver=forbidden)\nprint(json.dumps({'code':code,'receipt':receipt}))\n`
  const createConfig = { ...config, invokeAdapter: async (invocation: any) => {
    const fields = { operation: 'tenant.create', target, request_id: requestId, policy_file: invocation.args[invocation.args.indexOf('--policy-file') + 1] }
    const child = spawnSync('python3', ['-B', '-c', python, JSON.stringify(fields), `sha256:${catalogHash}`], { cwd: repo, env: invocation.env, encoding: 'utf8', timeout: 10000 })
    assert.equal(child.status, 0, child.stderr)
    return JSON.parse(child.stdout.trim())
  } }
  tenantStatus = 'provisioning'; finished = undefined; queries.length = 0
  await executeClaimed(pool, claim('tenant.create'), createConfig)
  assert.ok(finished)
  assert.equal(finished![0], 'failed')
  assert.equal(finished![1], 'preflight')
  assert.equal(finished![2].changed, false)
  assert.equal(finished![2].error.code, 'port_shared')
  assert.equal(finished![2].deployment_ready, false)
  assert.equal(tenantStatus, 'provisioning')
  assert.equal(queries.filter(q => q.sql.startsWith('UPDATE tenants SET status=')).length, 0)
  console.log(JSON.stringify({ finding: 'SAAS-04', observed: 'safe refusal leaves prior provisioning status without reset/intervention SQL', operationStatus: finished![0], error: finished![2].error.code, changed: finished![2].changed, tenantStatus }))
  console.log(JSON.stringify({ result: '4_current_gaps_reproduced_not_fixed', isolation: 'no listening server, real database, Docker, customer data or credential access', caveat: 'SQL effects recorded in memory; not PostgreSQL integration' }))
} finally {
  // Only this script's own mkdtemp fixture; never operational acceptance resources.
  await rm(root, { recursive: true, force: true })
}
