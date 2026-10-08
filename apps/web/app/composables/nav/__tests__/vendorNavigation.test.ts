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
    expect(contextLinksForModule('management', identity).map(m => m.to)).toEqual(['/vendor/overview', '/vendor/tenants', '/vendor/customers', '/vendor/bundles', '/vendor/plans', '/vendor/operations', '/vendor/audit'])
    expect(activeShellModule('/vendor/tenants/example')).toBe('management')
  })
  it('keeps bundles and plans under management without a billing link', () => {
    const links = contextLinksForModule('management', { capabilities: [], vendorCapabilities: ['vendor.read'] })
    expect(links.map(l => l.id)).toEqual(expect.arrayContaining(['vendor-bundles', 'vendor-plans']))
    expect(links.some(l => l.to.toString().includes('billing'))).toBe(false)
    expect(activeShellModule('/vendor/bundles/new')).toBe('management')
    expect(activeShellModule('/vendor/plans/abc/edit')).toBe('management')
  })
  it('lists customers for vendor.read and invoices only for billing managers', () => {
    const links = contextLinksForModule('management', { capabilities: [], vendorCapabilities: ['vendor.read'] })
    expect(links.map(l => l.id)).toContain('vendor-customers')
    expect(links.map(l => l.id)).not.toContain('vendor-invoices')
    expect(contextLinksForModule('management', { capabilities: [], vendorCapabilities: ['vendor.read', 'vendor.billing.manage'] }).map(l => l.id)).toContain('vendor-invoices')
    expect(activeShellModule('/vendor/customers/abc/terms/new')).toBe('management')
    expect(activeShellModule('/vendor/invoices/abc')).toBe('management')
    expect(contextLinksForModule('management', { capabilities: [], vendorCapabilities: [] }).length).toBe(0)
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
