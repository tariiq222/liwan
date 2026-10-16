import { test } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, renameSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readTenantRegistry } from '../../../../apps/web/server/utils/tenantRegistry.ts'
import { requestPlan, sessionCodec } from '../../../../deploy/shared/guard.mjs'

test('atomic registry replacement revokes the next request without reader restart', () => {
  // Retained synthetic evidence directory; no cleanup/deletion operation.
  const dir = mkdtempSync(join(tmpdir(), 'webvue-t5-registry-'))
  const path = join(dir, 'registry.json')
  const tenant = { tenantId: 'tenant_a', host: 'a.invalid', database: 'db_a', filestore: 'db_a', registryRevision: 1, enabled: true }
  const registry = { schemaVersion: 1, snapshotRevision: 1, targets: [tenant] }
  writeFileSync(path, JSON.stringify(registry))
  const codec = sessionCodec({ test: 'k'.repeat(32) }, 'test')
  const req = { url: '/api/v1/projects', headers: { host: 'a.invalid', cookie: `session_id=${codec.seal('synthetic_sid', tenant)}` } }
  assert.equal(requestPlan(req, readTenantRegistry(path), 't'.repeat(32), codec).tenant.tenantId, 'tenant_a')
  // A crash after the writer raises its barrier must deny even while the old
  // enabled file remains intact. This exercises the real guard consumer path.
  writeFileSync(`${path}.pending`, '')
  assert.throws(() => requestPlan(req, readTenantRegistry(path), 't'.repeat(32), codec), /tenant_registry_unavailable/)
  writeFileSync(join(dir, 'next.json'), JSON.stringify({ ...registry, snapshotRevision: 2, targets: [{ ...tenant, registryRevision: 2, enabled: false }] }))
  renameSync(join(dir, 'next.json'), path)
  assert.throws(() => requestPlan(req, readTenantRegistry(path), 't'.repeat(32), codec), /tenant_registry_unavailable/)
  unlinkSync(`${path}.pending`)
  assert.throws(() => requestPlan(req, readTenantRegistry(path), 't'.repeat(32), codec))
  writeFileSync(join(dir, 'next.json'), JSON.stringify({ ...registry, snapshotRevision: 3, targets: [{ ...tenant, registryRevision: 3 }] }))
  renameSync(join(dir, 'next.json'), path)
  assert.throws(() => requestPlan(req, readTenantRegistry(path), 't'.repeat(32), codec), /invalid_session/)
  assert.throws(() => readTenantRegistry(''), /tenant_registry_unavailable/)
})
