import { describe, expect, it } from 'vitest'
import { appManifests, manifestForPath, withManifests } from '../manifests'
import { canUse, featureForCapability, featureForPath, hasFeature, MODULE_FEATURES } from '../registry'
import { canReach, canReachPath, firstAllowedPath, hasCapability, isNavPathActive, postLoginPath, requiredCapabilityForPath } from '../../utils/accessPolicy'
import type { AppManifest } from '../types'
import { allNavItems } from '../../composables/nav/shellModules'
import { goKeyProblems } from '../../composables/nav/paletteModel'
import { appCommands } from '../surfaces'
import { SHELL_RESERVED_KEYS } from '@nasq/ui/app/composables/shortcuts/keymap'

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
    ['/meetings/series', 'meetings.enabled'], ['/hr/employees/3', 'hr.enabled'], ['/chat/3', 'chat.enabled'],
    ['/settings/users', null], ['/notifications', null], ['/account', null], ['/chatx', null], ['/zzz', null],
  ])('maps %s to its feature', (path, feature) => {
    expect(featureForPath(path)).toBe(feature)
  })

  it.each([
    ['/chat', 'nasq.internal'], ['/chat/new', 'nasq.internal'],
    ['/projects/settings', 'pmo.settings.manage'], ['/projects/settings/x', 'pmo.settings.manage'],
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
    expect(postLoginPath({ capabilities: ['pmo.tasks.read'] }, '/tasks?scope=archived')).toBe('/tasks?scope=archived')
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
    it('gates a claimed prefix that has no capability rule by the application feature', () => {
      const erp: AppManifest = { ...crm, id: 'erp', feature: 'erp.enabled', routePrefixes: ['/erp', '/erp-extra'], landing: [], routeCapabilities: [], bell: undefined }
      const open = { capabilities: [], platform: { readable_features: ['erp.enabled'], writable_features: ['erp.enabled'] } }
      const closed = { capabilities: [], platform: { readable_features: ['hr.enabled'], writable_features: [] } }
      withManifests([...appManifests, erp], () => {
        expect(requiredCapabilityForPath('/erp-extra/x')).toBeNull()
        expect(canReachPath(closed, '/erp-extra/x')).toBe(false)
        expect(canReachPath(open, '/erp-extra/x')).toBe(true)
        expect(canReachPath(closed, '/account')).toBe(true)
      })
    })
    it('refuses a nested withManifests', () => {
      withManifests([crm], () => {
        expect(() => withManifests([], () => 1)).toThrow(/already active/)
        expect(manifestForPath('/crm')?.id).toBe('crm')
      })
      expect(manifestForPath('/crm')).toBeNull()
    })
    it('is removed again afterwards, even when the callback throws', () => {
      expect(() => withManifests([crm], () => { throw new Error('boom') })).toThrow('boom')
      expect(manifestForPath('/crm')).toBeNull()
      expect(manifestForPath('/hr')?.id).toBe('hr')
    })
  })
})

describe('palette declarations', () => {
  it('go keys are single letters, never g, and unique across applications and the foundation', () => {
    expect(goKeyProblems(allNavItems())).toEqual([])
    expect(allNavItems().flatMap(item => item.goKey ?? []).sort()).toEqual(['c', 'd', 'e', 'h', 'm', 'p', 'r', 't', 'u'])
  })

  it('commands have unique ids under their manifest, open a path it owns and need that route\'s capability', () => {
    const ids = appCommands().map(command => command.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const manifest of appManifests) {
      for (const command of manifest.commands ?? []) {
        expect(command.id.startsWith(`${manifest.id}.`), command.id).toBe(true)
        expect(manifestForPath(command.to)?.id, command.id).toBe(manifest.id)
        expect(requiredCapabilityForPath(command.to), command.id).toBe(command.capability)
      }
    }
    expect(ids).toEqual(expect.arrayContaining([
      'pmo.new-project', 'pmo.new-task', 'meetings.new-meeting', 'meetings.new-series',
      'chat.new-conversation', 'hr.new-employee', 'hr.new-department', 'hr.new-document',
    ]))
  })

  // goKeys follow the `G` chord, so only `g` is off limits for them (goKeyProblems); c, j and k are fine there.
  it('no /search one-key jump uses a key the shell layer owns', () => {
    for (const item of allNavItems()) {
      expect(SHELL_RESERVED_KEYS, `${item.to} shortcut`).not.toContain(item.shortcut)
    }
  })

  it('/search one-key jumps are unique across manifests', () => {
    const jumps = appManifests.flatMap(manifest => manifest.nav.map(item => item.shortcut)).filter(Boolean)
    expect(new Set(jumps).size).toBe(jumps.length)
  })
})
