import { describe, expect, it } from 'vitest'
import { appManifests, manifestForPath, withManifests } from '../manifests'
import { canUse, featureForCapability, featureForPath, hasFeature, MODULE_FEATURES } from '../registry'
import { canReach, firstAllowedPath, hasCapability, isNavPathActive, postLoginPath, requiredCapabilityForPath } from '../../utils/accessPolicy'
import type { AppManifest } from '../types'

const crm: AppManifest = {
  id: 'crm',
  feature: 'crm.enabled',
  routePrefixes: ['/crm'],
  rail: [{ id: 'crm', labelKey: 'nav.crm', icon: 'i-lucide-handshake', to: '/crm', order: 60 }],
  nav: [],
  landing: [{ path: '/crm', capability: 'crm.leads.read' }],
  routeCapabilities: [{ pattern: /^\/crm\/leads\/new$/, capability: 'crm.leads.create' }],
  bell: { capabilities: ['crm.leads.read'] },
}

describe('app manifests', () => {
  // Additional applications may be added without editing this test: today's applications must stay present, in the same relative order.
  const inOrder = (actual: string[], expected: string[]) => actual.filter(id => expected.includes(id))
  it('discovers today\'s four applications in rail order', () => {
    const ids = appManifests.map(manifest => manifest.id)
    expect(inOrder(ids, ['pmo', 'meetings', 'chat', 'hr'])).toEqual(['pmo', 'meetings', 'chat', 'hr'])
    expect(new Set(ids).size).toBe(ids.length)
    const rail = appManifests.flatMap(manifest => manifest.rail.map(entry => entry.id))
    expect(inOrder(rail, ['home', 'projects', 'meetings', 'chat', 'hr'])).toEqual(['home', 'projects', 'meetings', 'chat', 'hr'])
    expect(new Set(rail).size).toBe(rail.length)
  })
  it('keeps the module feature map', () => {
    expect(MODULE_FEATURES).toMatchObject({
      home: 'pmo.enabled', projects: 'pmo.enabled', meetings: 'meetings.enabled', chat: 'chat.enabled', hr: 'hr.enabled',
      settings: null, vendor: null, management: null,
    })
  })

  it.each([
    ['/projects', 'pmo.enabled'], ['/projects/5/tasks/new', 'pmo.enabled'], ['/tasks/4', 'pmo.enabled'],
    ['/project-templates', 'pmo.enabled'], ['/reports', 'pmo.enabled'], ['/archived-tasks', 'pmo.enabled'],
    ['/meetings/series', 'meetings.enabled'], ['/hr/employees/3', 'hr.enabled'], ['/chat/3', 'chat.enabled'],
    ['/settings/users', null], ['/notifications', null], ['/account', null], ['/chatx', null], ['/zzz', null],
  ])('maps %s to its feature', (path, feature) => {
    expect(featureForPath(path)).toBe(feature)
  })

  it.each([
    ['/chat', 'nasq.internal'], ['/chat/new', 'nasq.internal'],
    ['/projects/settings', 'pmo.settings.manage'], ['/projects/settings/x', 'pmo.settings.manage'],
    ['/project-templates/new', 'pmo.settings.manage'], ['/project-templates/3/edit', 'pmo.settings.manage'],
    ['/project-templates/3', 'pmo.projects.read'], ['/archived-tasks', 'pmo.tasks.read'],
    ['/tasks/new', 'pmo.tasks.create'], ['/projects/5/tasks/new', 'pmo.tasks.create'], ['/projects/new', 'pmo.projects.create'],
    ['/projects/dashboard', 'pmo.projects.read'], ['/tasks/4', 'pmo.tasks.read'],
    ['/meetings/new', 'meetings.create'], ['/meetings/series/new', 'meetings.create'],
    ['/meetings/9/edit', 'meetings.read'], ['/meetings/9/resolutions/new', 'meetings.read'], ['/meetings/9', 'meetings.read'],
    ['/hr/documents/new', 'hr.documents.manage'], ['/hr/departments/7/documents/new', 'hr.documents.manage'],
    ['/hr/departments/7/documents/2/edit', 'hr.documents.manage'], ['/hr/departments/7/documents', 'hr.documents.read'],
    ['/hr/employees/new', 'hr.employees.manage'], ['/hr/employees/3/edit', 'hr.employees.manage'],
    ['/hr/departments/new', 'hr.departments.manage'], ['/hr/employees/3/access', 'access.users.grant'],
    ['/hr/departments', 'hr.departments.read'], ['/hr/documents', 'hr.documents.read'],
    ['/notifications', 'nasq.notifications'], ['/settings/users/new', 'access.users.grant'],
    ['/settings/users/3/access', 'access.users.assign_roles'], ['/settings/roles/4/edit', 'access.roles.manage'],
    ['/settings/roles/4', 'access.roles.read'], ['/settings/branding', 'settings.branding.manage'],
    ['/account', null], ['/zzz', null],
  ])('requires %s -> %s', (path, capability) => {
    expect(requiredCapabilityForPath(path)).toBe(capability)
  })

  it.each([
    ['/projects/dashboard', '/projects', false], ['/projects/settings/x', '/projects', false], ['/projects/5', '/projects', true],
    ['/meetings/calendar', '/meetings', false], ['/meetings/calendar', '/meetings/calendar', true],
    ['/meetings/series/3', '/meetings/series', true], ['/hr/employees/7/edit', '/hr', true], ['/hr/documents', '/hr', false],
    ['/hr/departments/7/documents/2', '/hr/departments', false], ['/hr/departments/7/documents/2', '/hr/documents', true],
  ])('nav active %s vs %s -> %s', (path, target, active) => {
    expect(isNavPathActive(path, target)).toBe(active)
  })

  it('keeps the landing order across applications and settings', () => {
    const all = ['pmo.projects.read', 'pmo.tasks.read', 'meetings.read', 'hr.employees.read', 'access.users.read', 'pmo.settings.manage', 'settings.branding.manage']
    expect(firstAllowedPath({ capabilities: all })).toBe('/projects/dashboard')
    expect(firstAllowedPath({ capabilities: ['hr.employees.read', 'access.users.read'] })).toBe('/hr')
    expect(firstAllowedPath({ capabilities: ['access.users.read', 'pmo.settings.manage'] })).toBe('/settings/users')
    expect(firstAllowedPath({ capabilities: ['pmo.settings.manage', 'settings.branding.manage'] })).toBe('/projects/settings')
    expect(postLoginPath({ capabilities: ['pmo.tasks.read'] }, '/archived-tasks')).toBe('/archived-tasks')
    expect(postLoginPath({ role: 'admin' }, '/chat')).toBe('/account')
  })

  it('aliases chat access and shared notifications through the manifests', () => {
    expect(featureForCapability('nasq.internal')).toBe('chat.enabled')
    expect(canUse({ platform: { readable_features: ['chat.enabled'], writable_features: [] } }, 'nasq.internal')).toBe(true)
    expect(hasCapability({ capabilities: ['hr.employees.read'] }, 'nasq.notifications')).toBe(false)
    expect(hasCapability({ capabilities: ['meetings.read'] }, 'nasq.notifications')).toBe(true)
    const onlyHr = { capabilities: ['meetings.read'], platform: { readable_features: ['hr.enabled'], writable_features: [] } }
    expect(canReach(onlyHr, 'nasq.notifications')).toBe(false)
  })

  describe('a manifest registered for a new application', () => {
    const identity = {
      capabilities: ['crm.leads.read', 'crm.leads.create'],
      platform: { readable_features: ['crm.enabled'], writable_features: ['crm.enabled'] },
    }
    const withoutCrm = { ...identity, platform: { readable_features: ['hr.enabled'], writable_features: [] } }

    it('is unknown to the policy until registered', () => {
      expect(manifestForPath('/crm')).toBeNull()
      expect(featureForPath('/crm')).toBeNull()
      expect(requiredCapabilityForPath('/crm')).toBeNull()
    })
    it('gates its routes by its feature, capability and landing', () => {
      withManifests([...appManifests, crm], () => {
        expect(manifestForPath('/crm/leads/3')?.id).toBe('crm')
        expect(featureForPath('/crm/leads/new')).toBe('crm.enabled')
        expect(requiredCapabilityForPath('/crm/leads/new')).toBe('crm.leads.create')
        expect(requiredCapabilityForPath('/crm')).toBe('crm.leads.read')
        expect(canReach(identity, 'crm.leads.read', '/crm')).toBe(true)
        expect(canReach(withoutCrm, 'crm.leads.read', '/crm')).toBe(false)
        expect(hasFeature(withoutCrm, featureForPath('/crm'))).toBe(false)
        expect(firstAllowedPath(identity)).toBe('/crm')
        expect(postLoginPath(identity, '/crm')).toBe('/crm')
        expect(postLoginPath(withoutCrm, '/crm')).toBe('/account')
        expect(hasCapability(identity, 'nasq.notifications')).toBe(true)
        expect(canUse(identity, 'nasq.notifications')).toBe(true)
        expect(canUse(withoutCrm, 'nasq.notifications')).toBe(false)
      })
    })
    it('is removed again afterwards, even when the callback throws', () => {
      expect(() => withManifests([crm], () => { throw new Error('boom') })).toThrow('boom')
      expect(manifestForPath('/crm')).toBeNull()
      expect(manifestForPath('/hr')?.id).toBe('hr')
    })
  })
})
