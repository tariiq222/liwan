import { test } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readTenantRegistry } from '../../../../apps/web/server/utils/tenantRegistry.ts'
import { readRegistries, requestPlan, sessionCodec } from '../../../../deploy/shared/guard.mjs'
import { realRestoreHost, writeRestoreRoute } from '../shared/odoo-backup.ts'

// The guard is the component that reads what the restore publication writes. These tests run the real writer and
// the real reader against each other, with no Docker and no database.
const suffix = 'saas.accept.liwan.test'
const token = 'synthetic-proxy-marker-'.repeat(3)
const codec = sessionCodec({ test: 'synthetic-signing-marker-'.repeat(3) }, 'test')
const approval = '687674dc-5789-4a99-b151-12d69f010cc3'
const database = 'liwan_scratch_' + 'a'.repeat(32)
const internal = host => ({ headers: { host, 'x-liwan-proxy-token': token, 'x-liwan-tenant-revision': '1' }, url: '/api/v1/me' })

function stateDir() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'liwan-restore-route-')))
  const registryPath = join(dir, 'registry.json')
  writeFileSync(registryPath, JSON.stringify({ schemaVersion: 1, snapshotRevision: 1, targets: [{ host: 'alpha.saas.accept.liwan.test', tenantId: 'alpha', database: 'db_alpha', filestore: 'db_alpha', enabled: true, registryRevision: 1 }] }))
  return { dir, registryPath, restoreRegistryPath: join(dir, 'restore-registry', 'registry.json') }
}

test('a published restore host resolves, through the guard reader, to the published database', async () => {
  const paths = stateDir()
  const host = realRestoreHost(approval, suffix)
  await writeRestoreRoute(paths.dir, approval, host, database)
  assert.equal(readTenantRegistry(paths.restoreRegistryPath).targets[0].host, host)
  const { registry, restoreTenantIds } = readRegistries(paths, host)
  const plan = requestPlan(internal(host), registry, token, codec)
  assert.equal(plan.tenant.database, database)
  assert.equal(plan.tenant.tenantId, 'r' + approval.replaceAll('-', ''))
  assert.equal(plan.headers.host, database)
  assert.deepEqual([...restoreTenantIds], [plan.tenant.tenantId])
  // The tenant registry is untouched and still resolves its own host.
  assert.equal(requestPlan(internal('alpha.saas.accept.liwan.test'), readRegistries(paths, 'alpha.saas.accept.liwan.test').registry, token, codec).tenant.database, 'db_alpha')
})

test('republishing the same route is idempotent and a second approval adds its own host', async () => {
  const paths = stateDir()
  const second = '0c0efe37-72e6-4c50-9e47-30649729347d'
  const secondDatabase = 'liwan_scratch_' + 'b'.repeat(32)
  await writeRestoreRoute(paths.dir, approval, realRestoreHost(approval, suffix), database)
  await writeRestoreRoute(paths.dir, approval, realRestoreHost(approval, suffix), database)
  await writeRestoreRoute(paths.dir, second, realRestoreHost(second, suffix), secondDatabase)
  const registry = readTenantRegistry(paths.restoreRegistryPath)
  assert.equal(registry.targets.length, 2)
  assert.equal(registry.snapshotRevision, 2)
  for (const [id, expected] of [[approval, database], [second, secondDatabase]]) {
    const host = realRestoreHost(id, suffix)
    assert.equal(requestPlan(internal(host), readRegistries(paths, host).registry, token, codec).tenant.database, expected)
  }
})

test('a route conflict is still refused and leaves the served route unchanged', async () => {
  const paths = stateDir()
  const host = realRestoreHost(approval, suffix)
  await writeRestoreRoute(paths.dir, approval, host, database)
  await assert.rejects(writeRestoreRoute(paths.dir, approval, host, 'liwan_scratch_' + 'c'.repeat(32)), /shared_restore_route_conflict/)
  assert.equal(requestPlan(internal(host), readRegistries(paths, host).registry, token, codec).tenant.database, database)
})

test('the published route cannot be served as a tenant: the reader refuses it once it clashes with the tenant registry', async () => {
  const paths = stateDir()
  const host = realRestoreHost(approval, suffix)
  await writeRestoreRoute(paths.dir, approval, host, 'db_alpha')
  assert.throws(() => readRegistries(paths, host), /restore_registry_unavailable/)
  assert.equal(readRegistries(paths, 'alpha.saas.accept.liwan.test').registry.targets.length, 1)
})

test('a missing restore directory is no route, not a failure of the tenant registry', () => {
  const paths = stateDir()
  mkdirSync(join(paths.dir, 'restore-registry'))
  const host = realRestoreHost(approval, suffix)
  assert.throws(() => requestPlan(internal(host), readRegistries(paths, host).registry, token, codec), /tenant_host_unavailable/)
})
