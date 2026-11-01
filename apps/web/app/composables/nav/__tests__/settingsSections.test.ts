import { describe, expect, it } from 'vitest'
import { appSettingsPages, partIsExact, settingsPageForPath, settingsPages, settingsPartPath, settingsPartTarget } from '../settingsSections'
import { isContextLinkActive } from '../../useShellNavigation'
import { appManifests, withManifests } from '../../../modules/manifests'
import type { AppManifest } from '../../../modules/types'

const page = (id: string) => settingsPages().find(candidate => candidate.id === id)!

describe('settings pages', () => {
  it('are the foundation pages around one page per application, in a fixed order', () => {
    expect(settingsPages().map(candidate => candidate.id)).toEqual(['company', 'team', 'projects', 'meetings', 'chat', 'hr', 'finance', 'operations', 'appointments', 'crm', 'inbox', 'payments', 'system', 'billing'])
    expect(settingsPages().map(candidate => candidate.group)).toEqual([undefined, undefined, 'settings.sections.apps.title', 'settings.sections.apps.title', 'settings.sections.apps.title', 'settings.sections.apps.title', 'settings.sections.apps.title', 'settings.sections.apps.title', 'settings.sections.apps.title', 'settings.sections.apps.title', 'settings.sections.apps.title', 'settings.sections.apps.title', undefined, undefined])
  })
  it('hold the cards of company and system as parts of one page', () => {
    expect(page('company').to).toBe('/settings/company')
    expect(page('company').parts.map(part => part.id)).toEqual(['profile', 'address', 'contact', 'branding'])
    expect(page('system').to).toBe('/settings/system')
    expect(page('system').parts.map(part => part.id)).toEqual(['integrations', 'maintenance'])
    expect(page('company').parts.every(part => part.to === undefined)).toBe(true)
    expect(page('team').to).toBe('/settings/team')
    expect(page('team').parts.map(part => part.within)).toEqual(['/settings/team/users', '/settings/team/roles', '/settings/team/branches', '/settings/team/access-log'])
  })
  it('keep billing as pages of their own', () => {
    expect(page('billing').parts.map(part => part.to)).toEqual(['/subscription', '/subscription/change', '/subscription/status', '/subscription/branches', '/subscription/invoices'])
  })
  it('build one page per application from the registered manifests', () => {
    const apps = () => appSettingsPages().map(candidate => candidate.to)
    expect(apps()).toEqual(['/settings/apps/projects', '/settings/apps/meetings', '/settings/apps/chat', '/settings/apps/hr', '/settings/apps/finance', '/settings/apps/operations/processes', '/settings/apps/appointments', '/settings/apps/crm', '/settings/apps/inbox', '/settings/apps/payments'])
    expect(page('payments').parts.map(part => [part.id, part.capability])).toEqual([['providers', 'payments.providers.manage'], ['orders', 'payments.settings.manage']])
    expect(page('meetings').parts.map(part => [part.id, part.capability])).toEqual([['schedule', 'meetings.settings.manage']])
    expect(page('chat').parts.map(part => [part.id, part.capability])).toEqual([['messages', 'chat.settings.manage']])
    expect(page('hr').parts.map(part => [part.id, part.capability])).toEqual([['leave', 'hr.leave.config'], ['payroll', 'hr.payroll.read'], ['audit', 'hr.payroll.audit.read'], ['shifts', 'hr.shifts.manage'], ['warnings', 'hr.warnings.manage'], ['branch-access', 'hr.employees.manage']])
    expect(page('projects').parts.map(part => part.id)).toEqual(['project-creation', 'project-defaults', 'project-reminders', 'catalogs'])
    expect(page('finance').parts.map(part => [part.id, part.to, part.within])).toEqual([['setup', undefined, undefined], ['accounts', '/settings/apps/finance/accounts', undefined], ['journals', '/settings/apps/finance/journals', undefined], ['taxes', '/settings/apps/finance/taxes', undefined], ['payment-terms', '/settings/apps/finance/payment-terms', undefined], ['asset-profiles', '/settings/apps/finance/asset-profiles', undefined], ['analytic', undefined, undefined], ['closing', undefined, undefined], ['zatca', undefined, undefined], ['audit', undefined, '/settings/apps/finance/audit']])
    const pilot: AppManifest = {
      id: 'pilot', feature: 'pilot.enabled', routePrefixes: ['/pilot'], rail: [{ id: 'pilot', labelKey: 'nav.pilot', icon: 'i-lucide-handshake', to: '/pilot', order: 90 }], nav: [],
      settings: { id: 'pilot', labelKey: 'nav.pilot', icon: 'i-lucide-handshake', to: '/settings/apps/pilot', parts: [{ id: 'pipeline', labelKey: 'pilot.settings', icon: 'i-lucide-handshake', capability: 'pilot.settings.manage' }] },
    }
    withManifests([...appManifests, pilot], () => expect(apps()).toContain('/settings/apps/pilot'))
  })
  it('own the paths beneath them, the subscription pages included', () => {
    expect(settingsPageForPath('/settings')).toBeNull()
    expect(settingsPageForPath('/settings/company#branding')?.id).toBe('company')
    expect(settingsPageForPath('/settings/team/users/3?x=1')?.id).toBe('team')
    expect(settingsPageForPath('/settings/apps/projects/catalogs/types')?.id).toBe('projects')
    expect(settingsPageForPath('/settings/apps/finance/audit')?.id).toBe('finance')
    expect(settingsPageForPath('/settings/apps/hr')?.id).toBe('hr')
    expect(settingsPageForPath('/subscription/invoices/4')?.id).toBe('billing')
    expect(settingsPageForPath('/settings/teams')).toBeNull()
  })
  it('send a card to its page with the id as hash, and a part with its own page to that page', () => {
    expect(settingsPartTarget(page('company'), page('company').parts[3]!)).toEqual({ path: '/settings/company', hash: '#branding' })
    expect(settingsPartTarget(page('team'), page('team').parts[1]!)).toEqual({ path: '/settings/team', hash: '#roles' })
    expect(settingsPartTarget(page('billing'), page('billing').parts[1]!)).toBe('/subscription/change')
    expect(settingsPartPath(page('company'), page('company').parts[3]!)).toBe('/settings/company#branding')
    expect(settingsPartPath(page('team'), page('team').parts[0]!)).toBe('/settings/team/users')
    expect(settingsPartPath(page('company'), page('company').parts[3]!)).toBe('/settings/company#branding')
    expect(settingsPartPath(page('company'), { ...page('company').parts[0]!, within: '/settings/company/all' })).toBe('/settings/company/all')
  })
  it('keeps a part with sibling pages beneath it from matching them', () => {
    const [pack, change] = page('billing').parts
    expect(partIsExact(pack!, [pack!, change!])).toBe(true)
    expect(partIsExact(change!, [pack!, change!])).toBe(false)
    expect(partIsExact(page('company').parts[0]!, page('company').parts)).toBe(false)
  })
  it('mark links active by prefix, by their own exact path, by the shared rule or by the card being read', () => {
    expect(isContextLinkActive('/settings/team/roles', { to: '/settings/team/users', within: '/settings/team' })).toBe(true)
    expect(isContextLinkActive('/settings/company', { to: '/settings/team/users', within: '/settings/team' })).toBe(false)
    expect(isContextLinkActive('/subscription/status', { to: '/subscription', exact: true })).toBe(false)
    expect(isContextLinkActive('/subscription/', { to: '/subscription', exact: true })).toBe(true)
    expect(isContextLinkActive('/settings/team/users', { to: '/settings', exact: true })).toBe(false)
    expect(isContextLinkActive('/settings/team/users/3', { to: '/settings/team/users' })).toBe(true)
    const contact = { path: '/settings/company', hash: '#contact' }
    expect(isContextLinkActive('/settings/company', { to: contact }, 'contact')).toBe(true)
    expect(isContextLinkActive('/settings/company', { to: contact }, 'branding')).toBe(false)
    expect(isContextLinkActive('/settings/system', { to: contact }, 'contact')).toBe(false)
    // A card with a full list page stays lit there too.
    const audit = { to: { path: '/settings/apps/finance', hash: '#audit' }, within: '/settings/apps/finance/audit' }
    expect(isContextLinkActive('/settings/apps/finance/audit', audit, 'setup')).toBe(true)
    expect(isContextLinkActive('/settings/apps/finance', audit, 'setup')).toBe(false)
  })
})
