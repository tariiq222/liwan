import { describe, expect, it } from 'vitest'
import { visibleShellModules, contextLinksForModule } from '../shellModules'
import { activeShellModule } from '../activeRoute'

describe('company vendor administration navigation', () => {
  it('does not grant global operations to a customer vendor-support role', () => {
    expect(visibleShellModules({ role: 'vendor', capabilities: ['pmo.projects.read'] }).some(m => m.id === 'management')).toBe(false)
  })
  it('shows administration only from separate current vendor grants', () => {
    const identity = { capabilities: ['pmo.projects.read'], vendorCapabilities: ['vendor.read', 'vendor.audit.read'] }
    expect(visibleShellModules(identity).find(m => m.id === 'management')?.to).toBe('/vendor/overview')
    expect(contextLinksForModule('management', identity).map(m => m.to)).toEqual(['/vendor/overview', '/vendor/tenants', '/vendor/catalog', '/vendor/operations', '/vendor/audit'])
    expect(activeShellModule('/vendor/tenants/example')).toBe('management')
  })
  it('does not expose create or audit actions to a read-only operator', () => {
    const identity = { capabilities: [], vendorCapabilities: ['vendor.read'] }
    const links = contextLinksForModule('management', identity)
    expect(links.some(m => m.to === '/vendor/tenants/new' || m.to === '/vendor/audit')).toBe(false)
  })
  it('adds create only for explicit management grant and hides after revoke', () => {
    const identity = { capabilities: [], vendorCapabilities: ['vendor.read', 'vendor.tenants.manage'] }
    expect(contextLinksForModule('management', identity).some(m => m.to === '/vendor/tenants/new')).toBe(true)
    expect(visibleShellModules({ ...identity, vendorCapabilities: [] }).some(m => m.id === 'management')).toBe(false)
  })
})
