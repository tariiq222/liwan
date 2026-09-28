import { mkdtempSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readTenantRegistry } from '../tenantRegistry'

const snapshot = { schemaVersion: 1, snapshotRevision: 1, targets: [{
  host: 'publication.invalid', tenantId: 'publication', database: 'publication',
  filestore: 'publication', enabled: true, registryRevision: 1,
}] }

describe('registry publication interruption boundary', () => {
  it('rejects a dangling publication marker and resumes only the current snapshot', () => {
    const directory = mkdtempSync(join(tmpdir(), 'nasq-registry-reader-'))
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
    const directory = mkdtempSync(join(tmpdir(), 'nasq-registry-reader-'))
    const path = join(directory, 'registry.json')
    writeFileSync(path, JSON.stringify(snapshot))
    expect(readTenantRegistry(path)).toEqual(snapshot)
    writeFileSync(`${path}.pending`, 'publication in progress')
    expect(() => readTenantRegistry(path)).toThrow('tenant_registry_unavailable')
  })
  it('does not interpret an empty pending marker as permission to serve', () => {
    const directory = mkdtempSync(join(tmpdir(), 'nasq-registry-reader-'))
    const path = join(directory, 'registry.json')
    writeFileSync(path, JSON.stringify(snapshot))
    writeFileSync(`${path}.pending`, '')
    expect(() => readTenantRegistry(path)).toThrow('tenant_registry_unavailable')
  })
})
