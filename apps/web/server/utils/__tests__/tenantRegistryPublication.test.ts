import { mkdtempSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mutateRegistry, readTenantRegistry, validateRegistry } from '../tenantRegistry'

const snapshot = { schemaVersion: 1, snapshotRevision: 1, targets: [{
  host: 'publication.invalid', tenantId: 'publication', database: 'publication',
  filestore: 'publication', enabled: true, registryRevision: 1,
}] }

describe('registry publication interruption boundary', () => {
  it('rejects a dangling publication marker and resumes only the current snapshot', () => {
    const directory = mkdtempSync(join(tmpdir(), 'webvue-registry-reader-'))
    const path = join(directory, 'registry.json')
    writeFileSync(path, JSON.stringify(snapshot))
    symlinkSync(join(directory, 'missing-marker-target'), `${path}.pending`)
    expect(() => readTenantRegistry(path)).toThrow('tenant_registry_unavailable')
    const disabled = { ...snapshot, snapshotRevision: 2, targets: snapshot.targets.map(target => ({ ...target, enabled: false, registryRevision: 2 })) }
    writeFileSync(path, JSON.stringify(disabled))
    expect(() => readTenantRegistry(path)).toThrow('tenant_registry_unavailable')
    // Remove only the synthetic marker created by this test, as publication would.
    unlinkSync(`${path}.pending`)
    expect(readTenantRegistry(path)).toEqual(disabled)
  })
  it('refuses the old enabled snapshot while durable publication is pending', () => {
    const directory = mkdtempSync(join(tmpdir(), 'webvue-registry-reader-'))
    const path = join(directory, 'registry.json')
    writeFileSync(path, JSON.stringify(snapshot))
    expect(readTenantRegistry(path)).toEqual(snapshot)
    writeFileSync(`${path}.pending`, 'publication in progress')
    expect(() => readTenantRegistry(path)).toThrow('tenant_registry_unavailable')
  })
  it('does not interpret an empty pending marker as permission to serve', () => {
    const directory = mkdtempSync(join(tmpdir(), 'webvue-registry-reader-'))
    const path = join(directory, 'registry.json')
    writeFileSync(path, JSON.stringify(snapshot))
    writeFileSync(`${path}.pending`, '')
    expect(() => readTenantRegistry(path)).toThrow('tenant_registry_unavailable')
  })
  it('accepts the control plane deny-all bootstrap snapshot and rejects malformed empty ones', () => {
    const bootstrap = { schemaVersion: 1, snapshotRevision: 0, targets: [] }
    expect(validateRegistry(bootstrap)).toEqual(bootstrap)
    const directory = mkdtempSync(join(tmpdir(), 'webvue-registry-reader-'))
    const path = join(directory, 'registry.json')
    writeFileSync(path, JSON.stringify(bootstrap))
    expect(readTenantRegistry(path)).toEqual(bootstrap)
    writeFileSync(`${path}.pending`, '')
    expect(() => readTenantRegistry(path)).toThrow('tenant_registry_unavailable')
    expect(() => validateRegistry({ ...bootstrap, snapshotRevision: 1 })).toThrow('tenant_registry_invalid')
    expect(() => validateRegistry({ ...bootstrap, snapshotRevision: -1 })).toThrow('tenant_registry_invalid')
    expect(() => validateRegistry({ ...snapshot, snapshotRevision: 0 })).toThrow('tenant_registry_invalid')
    expect(() => validateRegistry({ schemaVersion: 1, snapshotRevision: 0 })).toThrow('tenant_registry_invalid')
  })
  it('lets the first publication extend the bootstrap snapshot', () => {
    const bootstrap = { schemaVersion: 1 as const, snapshotRevision: 0, targets: [] }
    const { registry } = mutateRegistry(bootstrap, snapshot.targets[0]!, { actor: 'operator', canManageRegistry: true }, 0)
    expect(registry.snapshotRevision).toBe(1)
    expect(registry.targets).toEqual(snapshot.targets)
  })
  it('requires management authority and matching revisions for the first publication', () => {
    const bootstrap = { schemaVersion: 1 as const, snapshotRevision: 0, targets: [] }
    const target = snapshot.targets[0]!
    const authority = { actor: 'operator', canManageRegistry: true }
    expect(() => mutateRegistry(bootstrap, target, { ...authority, canManageRegistry: false }, 0)).toThrow('registry_forbidden')
    expect(() => mutateRegistry(bootstrap, target, { ...authority, actor: '' }, 0)).toThrow('registry_forbidden')
    expect(() => mutateRegistry(bootstrap, target, authority, 1)).toThrow('registry_revision_conflict')
    expect(() => mutateRegistry(bootstrap, { ...target, registryRevision: 2 }, authority, 0)).toThrow('registry_revision_conflict')
  })
})
