import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import type { H3Event } from 'h3'
import { tenantRequest } from '../tenantRequest'
import { readTenantRegistry, readTenantRegistrySnapshot } from '../tenantRegistry'

vi.mock('node:fs', async original => {
  const actual = await original<typeof import('node:fs')>()
  return { ...actual, readFileSync: vi.fn(actual.readFileSync), lstatSync: vi.fn(actual.lstatSync) }
})

const token = 't'.repeat(40)
const target = { host: 'tenant.example.test', tenantId: 'tenant', database: 'tenant', filestore: 'tenant', registryRevision: 1, enabled: true }
function fixture() {
  const path = join(fs.mkdtempSync(join(tmpdir(), 'liwan-request-snapshot-')), 'registry.json')
  const publish = (overrides = {}) => fs.writeFileSync(path, JSON.stringify({ schemaVersion: 1, snapshotRevision: 2, targets: [{ ...target, ...overrides }] }))
  publish()
  vi.stubEnv('LIWAN_TENANCY_MODE', 'shared'); vi.stubEnv('LIWAN_SHARED_PROXY_TOKEN', token); vi.stubEnv('LIWAN_TENANT_REGISTRY_PATH', path)
  const event = { context: {}, node: { req: { headers: { host: target.host, 'x-liwan-proxy-token': token, 'x-liwan-tenant-revision': '1' } } } } as unknown as H3Event
  return { event, path, publish }
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })
it('reads and validates an unchanged registry only once within a request', () => {
  const { event } = fixture()
  const read = vi.mocked(fs.readFileSync).mockClear()
  expect(tenantRequest(event)?.database).toBe('tenant')
  expect(tenantRequest(event)?.database).toBe('tenant')
  expect(tenantRequest(event)?.database).toBe('tenant')
  expect(read).toHaveBeenCalledTimes(1)
})
it.each(['pending', 'disabled', 'revision'] as const)('rejects a %s publication after a request snapshot was validated', kind => {
  const { event, path, publish } = fixture()
  expect(tenantRequest(event)?.database).toBe('tenant')
  if (kind === 'pending') fs.writeFileSync(`${path}.pending`, '')
  else publish(kind === 'disabled' ? { enabled: false } : { registryRevision: 2 })
  // A barrier means the registry is unavailable (503); a changed identity is a boundary refusal (403).
  expect(() => tenantRequest(event)).toThrow(kind === 'pending' ? 'tenant_registry_unavailable' : 'tenant_boundary_rejected')
})

it('rejects publication completed between snapshot identity and pending-marker checks', async () => {
  const { event, publish } = fixture()
  tenantRequest(event)
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  let checks = 0
  vi.mocked(fs.lstatSync).mockImplementation(((...args: Parameters<typeof fs.lstatSync>) => {
    if (++checks === 2) publish({ enabled: false, registryRevision: 2 })
    return actual.lstatSync(...args)
  }) as typeof fs.lstatSync)
  // The file changed between the two identity checks: an uncertain read is unavailable, never served.
  try { expect(() => tenantRequest(event)).toThrow('tenant_registry_unavailable') }
  finally { vi.mocked(fs.lstatSync).mockImplementation(actual.lstatSync) }
})

function otherRequest(event: H3Event): H3Event {
  return { context: {}, node: { req: { headers: { ...event.node.req.headers } } } } as unknown as H3Event
}
it('shares one validated registry index between two concurrent request events', () => {
  const { event } = fixture()
  const other = otherRequest(event)
  const read = vi.mocked(fs.readFileSync).mockClear()
  expect(tenantRequest(event)?.database).toBe('tenant')
  expect(tenantRequest(other)?.database).toBe('tenant')
  expect(read).toHaveBeenCalledTimes(1)
})
it.each(['pending', 'disabled', 'revision', 'rebind'] as const)('refuses %s publication for both events sharing a snapshot', kind => {
  const { event, path, publish } = fixture()
  const other = otherRequest(event)
  tenantRequest(event); tenantRequest(other)
  if (kind === 'pending') fs.writeFileSync(`${path}.pending`, '')
  else publish(kind === 'disabled' ? { enabled: false } : kind === 'revision' ? { registryRevision: 2 } : { database: 'replacement', filestore: 'replacement' })
  // A barrier is an unavailable registry for both events; a changed identity is a boundary refusal for both.
  const expected = kind === 'pending' ? 'tenant_registry_unavailable' : 'tenant_boundary_rejected'
  expect(() => tenantRequest(event)).toThrow(expected)
  expect(() => tenantRequest(other)).toThrow(expected)
})
it('does not use a shared snapshot from another registry path or changed signature', () => {
  const first = fixture()
  const retained = readTenantRegistrySnapshot(first.path)
  const second = fixture()
  const read = vi.mocked(fs.readFileSync).mockClear()
  second.publish({ database: 'second', filestore: 'second' })
  expect(tenantRequest(second.event)?.database).toBe('second')
  second.publish({ enabled: false })
  expect(() => tenantRequest(otherRequest(second.event))).toThrow('tenant_boundary_rejected')
  expect(retained.hosts[target.host]?.database).toBe('tenant')
  expect(read).toHaveBeenCalledTimes(2)
})
it('shares only immutable snapshots and leaves standalone readers fresh', () => {
  const { path } = fixture()
  const first = readTenantRegistrySnapshot(path)
  const second = readTenantRegistrySnapshot(path)
  expect(second).toBe(first)
  expect(Object.isFrozen(first)).toBe(true)
  expect(Object.isFrozen(first.hosts)).toBe(true)
  expect(Object.isFrozen(first.hosts[target.host])).toBe(true)
  expect(() => { (first.hosts[target.host] as { enabled: boolean }).enabled = false }).toThrow(TypeError)
  const read = vi.mocked(fs.readFileSync).mockClear()
  const standalone = readTenantRegistry(path)
  standalone.targets[0]!.enabled = false
  expect(readTenantRegistry(path).targets[0]?.enabled).toBe(true)
  expect(first.hosts[target.host]?.enabled).toBe(true)
  expect(read).toHaveBeenCalledTimes(2)
})
