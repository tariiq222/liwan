import { describe, expect, it } from 'vitest'
import { entryIsExact, settingsSectionIdForPath, settingsSections } from '../settingsSections'
import { isContextLinkActive } from '../../useShellNavigation'
import { appManifests, withManifests } from '../../../modules/manifests'
import type { AppManifest } from '../../../modules/types'

describe('settings sections', () => {
  it('are five, in a fixed order', () => {
    expect(settingsSections().map(section => section.id)).toEqual(['company', 'team', 'apps', 'system', 'billing'])
  })
  it('hold the moved pages under their section prefixes', () => {
    const byId = Object.fromEntries(settingsSections().map(section => [section.id, section.entries.map(entry => entry.to)]))
    expect(byId.company).toEqual(['/settings/company/profile', '/settings/company/address', '/settings/company/contact', '/settings/company/branding'])
    expect(byId.team).toEqual(['/settings/team/users', '/settings/team/roles', '/settings/team/access-log'])
    expect(byId.system).toEqual(['/settings/system/integrations', '/settings/system/maintenance'])
    expect(byId.billing).toEqual(['/subscription', '/subscription/change', '/subscription/status', '/subscription/branches', '/subscription/invoices'])
  })
  it('build Apps from the registered manifests', () => {
    const apps = () => settingsSections().find(section => section.id === 'apps')!.entries.map(entry => entry.to)
    expect(apps()).toEqual(['/settings/apps/projects', '/settings/apps/finance', '/settings/apps/operations/processes'])
    const crm: AppManifest = { id: 'crm', feature: 'crm.enabled', routePrefixes: ['/crm'], rail: [{ id: 'crm', labelKey: 'nav.crm', icon: 'i-lucide-handshake', to: '/crm', order: 90 }], nav: [], settings: [{ id: 'crm', labelKey: 'crm.settings', icon: 'i-lucide-handshake', to: '/settings/apps/crm', capability: 'crm.settings.manage' }] }
    withManifests([...appManifests, crm], () => expect(apps()).toContain('/settings/apps/crm'))
  })
  it('own the paths beneath them, the subscription pages included', () => {
    expect(settingsSectionIdForPath('/settings')).toBeNull()
    expect(settingsSectionIdForPath('/settings/team/users/3?x=1')).toBe('team')
    expect(settingsSectionIdForPath('/settings/apps/projects/catalogs/types')).toBe('apps')
    expect(settingsSectionIdForPath('/subscription/invoices/4')).toBe('billing')
    expect(settingsSectionIdForPath('/settings/teams')).toBeNull()
  })
  it('keeps a page with sibling pages beneath it from matching them', () => {
    const [pack, change] = settingsSections().find(section => section.id === 'billing')!.entries
    expect(entryIsExact(pack!, [pack!, change!])).toBe(true)
    expect(entryIsExact(change!, [pack!, change!])).toBe(false)
  })
  it('mark links active by prefix, by their own exact path, or by the shared rule', () => {
    expect(isContextLinkActive('/settings/team/roles', { to: '/settings/team/users', within: '/settings/team' })).toBe(true)
    expect(isContextLinkActive('/settings/company/branding', { to: '/settings/team/users', within: '/settings/team' })).toBe(false)
    expect(isContextLinkActive('/subscription/status', { to: '/subscription', exact: true })).toBe(false)
    expect(isContextLinkActive('/subscription/', { to: '/subscription', exact: true })).toBe(true)
    expect(isContextLinkActive('/settings/team/users', { to: '/settings', exact: true })).toBe(false)
    expect(isContextLinkActive('/settings/team/users/3', { to: '/settings/team/users' })).toBe(true)
  })
})
