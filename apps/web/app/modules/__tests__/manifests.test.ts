import { describe, expect, it } from 'vitest'
import { appManifests, manifestForPath, withManifests } from '../manifests'
import { canUse, featureForCapability, featureForPath, hasFeature, MODULE_FEATURES } from '../registry'
import { canReach, canReachPath, firstAllowedPath, hasCapability, isNavPathActive, postLoginPath, requiredCapabilityForPath } from '../../utils/accessPolicy'
import type { AppManifest } from '../types'
import { allNavItems, contextLinksForModule } from '../../composables/nav/shellModules'
import { goKeyProblems } from '../../composables/nav/paletteModel'
import { isContextLinkActive } from '../../composables/useShellNavigation'
import { appCommands } from '../surfaces'
import { SHELL_RESERVED_KEYS } from '@liwan/ui/app/composables/shortcuts/keymap'

const pilot: AppManifest = {
  id: 'pilot',
  feature: 'pilot.enabled',
  routePrefixes: ['/pilot'],
  rail: [{ id: 'pilot', labelKey: 'nav.pilot', icon: 'i-lucide-handshake', to: '/pilot', order: 60 }],
  nav: [],
  landing: [{ path: '/pilot', capability: 'pilot.leads.read' }],
  routeCapabilities: [{ pattern: /^\/pilot\/leads\/new$/, capability: 'pilot.leads.create' }],
  bell: { capabilities: ['pilot.leads.read'] },
}

describe('app manifests', () => {
  // Additional applications may be added without editing this test: today's applications must stay present, in the same relative order.
  const inOrder = (actual: string[], expected: string[]) => actual.filter(id => expected.includes(id))
  it('discovers today\'s four applications in rail order', () => {
    const ids = appManifests.map(manifest => manifest.id)
    expect(inOrder(ids, ['pmo', 'meetings', 'chat', 'hr', 'ai'])).toEqual(['pmo', 'meetings', 'chat', 'hr', 'ai'])
    expect(new Set(ids).size).toBe(ids.length)
    const rail = appManifests.flatMap(manifest => manifest.rail.map(entry => entry.id))
    expect(inOrder(rail, ['projects', 'meetings', 'chat', 'hr', 'ai'])).toEqual(['projects', 'meetings', 'chat', 'hr', 'ai'])
    expect(new Set(rail).size).toBe(rail.length)
  })
  it('opens /ai by the real ai.use capability and the ai.enabled feature, with no alias', () => {
    expect(appManifests.find(manifest => manifest.id === 'ai')?.capabilityAliases).toBeUndefined()
    expect(featureForCapability('ai.use')).toBe('ai.enabled')
    const on = { capabilities: ['ai.use'], platform: { readable_features: ['ai.enabled'], writable_features: ['ai.enabled'] } }
    const off = { capabilities: ['ai.use'], platform: { readable_features: ['hr.enabled'], writable_features: [] } }
    expect(canReach(on, 'ai.use', '/ai')).toBe(true)
    expect(canReach({ ...on, capabilities: [] }, 'ai.use', '/ai')).toBe(false)
    expect(canReach(off, 'ai.use', '/ai')).toBe(false)
  })
  it('keeps the module feature map', () => {
    expect(MODULE_FEATURES).toMatchObject({
      home: null, projects: 'pmo.enabled', meetings: 'meetings.enabled', chat: 'chat.enabled', hr: 'hr.enabled', ai: 'ai.enabled',
      settings: null,
    })
  })

  it.each([
    ['/projects', 'pmo.enabled'], ['/projects/5/tasks/new', 'pmo.enabled'], ['/tasks/4', 'pmo.enabled'],
    ['/meetings/series', 'meetings.enabled'], ['/hr/employees/3', 'hr.enabled'], ['/chat/3', 'chat.enabled'],
    ['/settings/team/users', null], ['/notifications', null], ['/account', null], ['/chatx', null], ['/zzz', null],
  ])('maps %s to its feature', (path, feature) => {
    expect(featureForPath(path)).toBe(feature)
  })

  it.each([
    ['/chat', 'liwan.internal'], ['/chat/new', 'liwan.internal'],
    ['/settings/apps/projects', 'pmo.settings.manage'], ['/settings/apps/projects/x', 'pmo.settings.manage'],
    ['/tasks/new', 'pmo.tasks.create'], ['/projects/5/tasks/new', 'pmo.tasks.create'], ['/projects/new', 'pmo.projects.create'],
    ['/projects/dashboard', 'pmo.projects.read'], ['/tasks/4', 'pmo.tasks.read'],
    ['/meetings/new', 'meetings.create'], ['/meetings/series/new', 'meetings.create'],
    ['/meetings/9/edit', 'meetings.read'], ['/meetings/9/resolutions/new', 'meetings.read'], ['/meetings/9', 'meetings.read'],
    ['/documents/new', 'documents.items.manage'],
    ['/documents/2/edit', 'documents.items.manage'], ['/documents/2/access', 'documents.access.manage'],
    ['/hr/employees/new', 'hr.employees.manage'], ['/hr/employees/3/edit', 'hr.employees.manage'],
    ['/hr/departments/new', 'hr.departments.manage'], ['/hr/employees/3/access', 'access.users.grant'], ['/hr/employees/3/compensation', 'hr.payroll.manage'],
    ['/hr/departments', 'hr.departments.read'], ['/documents', 'documents.items.read'],
    ['/hr/leave', 'hr.leave.read'], ['/hr/leave/5', 'hr.leave.read'], ['/hr/reports', 'hr.employees.read'], ['/account/leave/new', 'hr.leave.request'], ['/hr/leave/allocations/new', 'hr.leave.manage'], ['/hr/leave/allocations', 'hr.leave.manage'], ['/hr/leave/allocations/9', 'hr.leave.manage'],
    ['/hr/recruitment', 'hr.recruitment.read'], ['/hr/recruitment/new', 'hr.recruitment.manage'], ['/hr/recruitment/jobs/new', 'hr.recruitment.manage'],
    ['/hr/shifts', 'hr.shifts.read'], ['/hr/shifts/schedules/new', 'hr.shifts.manage'],
    ['/hr/onboarding/9', 'hr.onboarding.read'], ['/hr/onboarding/plans/new', 'hr.onboarding.manage'],
    ['/hr/offboarding', 'hr.offboarding.read'], ['/hr/offboarding/new', 'hr.offboarding.manage'],
    ['/hr/assets/4', 'hr.assets.read'], ['/account/assets', 'hr.employees.read'], ['/hr/assets/categories/new', 'hr.assets.manage'],
    ['/hr/warnings', 'hr.warnings.read'], ['/hr/warnings/new', 'hr.employees.read'], ['/hr/warnings/4', 'hr.employees.read'], ['/hr/warnings/4/extra', 'hr.warnings.read'], ['/account/warnings', 'hr.employees.read'],
    ['/hr/payroll', 'hr.payroll.read'], ['/hr/payroll/4', 'hr.payroll.read'], ['/hr/payroll/4/payslips/9', 'hr.payroll.read'],
    ['/hr/payroll/new', 'hr.payroll.manage'],
    ['/account/pay', 'hr.employees.read'], ['/account/pay/7', 'hr.employees.read'],
    ['/notifications', 'liwan.notifications'], ['/settings/team/users/new', 'access.users.grant'],
    ['/settings/team/users/3/access', 'access.users.assign_roles'], ['/settings/team/roles/4/edit', 'access.roles.manage'],
    ['/settings/team/roles/4', 'access.roles.read'], ['/settings/company', 'settings.company.read'],
    ['/account', null], ['/zzz', null],
  ])('requires %s -> %s', (path, capability) => {
    expect(requiredCapabilityForPath(path)).toBe(capability)
  })

  it.each([
    ['/projects/dashboard', '/projects', false], ['/settings/apps/projects/x', '/projects', false], ['/projects/5', '/projects', true],
    ['/meetings/calendar', '/meetings', true], ['/meetings/calendar', '/meetings/calendar', true],
    ['/meetings/series/3', '/meetings/series', true], ['/hr/employees/7/edit', '/hr', true], ['/hr/documents', '/hr', false],
    ['/documents/2', '/documents', true],
    ['/account/assets', '/account/assets', true], ['/account/assets', '/hr/assets', false], ['/hr/assets/4', '/hr/assets', true],
    ['/account/warnings', '/account/warnings', true], ['/account/warnings', '/hr/warnings', false], ['/hr/warnings/4', '/hr/warnings', true],
    ['/account/pay', '/account/pay', true], ['/account/pay/7', '/account/pay', true], ['/account/pay', '/hr/payroll', false],
    ['/account/pay/7', '/hr/payroll', false], ['/hr/payroll', '/hr/payroll', true], ['/hr/payroll/new', '/hr/payroll', true],
    ['/hr/payroll/4/payslips/9', '/hr/payroll', true]
  ])('nav active %s vs %s -> %s', (path, target, active) => {
    expect(isNavPathActive(path, target)).toBe(active)
  })

  it('keeps the landing order across applications and settings', () => {
    const all = ['pmo.projects.read', 'pmo.tasks.read', 'meetings.read', 'hr.employees.read', 'access.users.read', 'pmo.settings.manage', 'settings.branding.manage']
    expect(firstAllowedPath({ capabilities: all })).toBe('/projects/dashboard')
    expect(firstAllowedPath({ capabilities: ['hr.employees.read', 'access.users.read'] })).toBe('/hr')
    expect(firstAllowedPath({ capabilities: ['hr.payroll.read'] })).toBe('/hr/payroll')
    expect(firstAllowedPath({ capabilities: ['access.users.read', 'pmo.settings.manage'] })).toBe('/settings/team/users')
    expect(firstAllowedPath({ capabilities: ['pmo.settings.manage', 'settings.branding.manage'] })).toBe('/settings/apps/projects')
    expect(postLoginPath({ capabilities: ['pmo.tasks.read'] }, '/tasks?scope=archived')).toBe('/tasks?scope=archived')
    expect(postLoginPath({ role: 'admin' }, '/chat')).toBe('/account')
  })

  it('aliases chat access and shared notifications through the manifests', () => {
    expect(featureForCapability('liwan.internal')).toBe('chat.enabled')
    expect(canUse({ platform: { readable_features: ['chat.enabled'], writable_features: [] } }, 'liwan.internal')).toBe(true)
    expect(hasCapability({ capabilities: ['hr.employees.read'] }, 'liwan.notifications')).toBe(true)
    expect(hasCapability({ capabilities: ['documents.items.read'] }, 'liwan.notifications')).toBe(false)
    expect(hasCapability({ capabilities: ['meetings.read'] }, 'liwan.notifications')).toBe(true)
    const onlyHr = { capabilities: ['meetings.read'], platform: { readable_features: ['hr.enabled'], writable_features: [] } }
    expect(canReach(onlyHr, 'liwan.notifications')).toBe(false)
  })

  describe('a manifest registered for a new application', () => {
    const identity = {
      capabilities: ['pilot.leads.read', 'pilot.leads.create'],
      platform: { readable_features: ['pilot.enabled'], writable_features: ['pilot.enabled'] },
    }
    const withoutPilot = { ...identity, platform: { readable_features: ['hr.enabled'], writable_features: [] } }

    it('is unknown to the policy until registered', () => {
      expect(manifestForPath('/pilot')).toBeNull()
      expect(featureForPath('/pilot')).toBeNull()
      expect(requiredCapabilityForPath('/pilot')).toBeNull()
    })
    it('gates its routes by its feature, capability and landing', () => {
      withManifests([...appManifests, pilot], () => {
        expect(manifestForPath('/pilot/leads/3')?.id).toBe('pilot')
        expect(featureForPath('/pilot/leads/new')).toBe('pilot.enabled')
        expect(requiredCapabilityForPath('/pilot/leads/new')).toBe('pilot.leads.create')
        expect(requiredCapabilityForPath('/pilot')).toBe('pilot.leads.read')
        expect(canReach(identity, 'pilot.leads.read', '/pilot')).toBe(true)
        expect(canReach(withoutPilot, 'pilot.leads.read', '/pilot')).toBe(false)
        expect(hasFeature(withoutPilot, featureForPath('/pilot'))).toBe(false)
        expect(firstAllowedPath(identity)).toBe('/pilot')
        expect(postLoginPath(identity, '/pilot')).toBe('/pilot')
        expect(postLoginPath(withoutPilot, '/pilot')).toBe('/')
        expect(hasCapability(identity, 'liwan.notifications')).toBe(true)
        expect(canUse(identity, 'liwan.notifications')).toBe(true)
        expect(canUse(withoutPilot, 'liwan.notifications')).toBe(false)
      })
    })
    it('gates a claimed prefix that has no capability rule by the application feature', () => {
      const erp: AppManifest = { ...pilot, id: 'erp', feature: 'erp.enabled', routePrefixes: ['/erp', '/erp-extra'], landing: [], routeCapabilities: [], bell: undefined }
      const open = { capabilities: [], platform: { readable_features: ['erp.enabled'], writable_features: ['erp.enabled'] } }
      const closed = { capabilities: [], platform: { readable_features: ['hr.enabled'], writable_features: [] } }
      withManifests([...appManifests, erp], () => {
        expect(requiredCapabilityForPath('/erp-extra/x')).toBeNull()
        expect(canReachPath(closed, '/erp-extra/x')).toBe(false)
        expect(canReachPath(open, '/erp-extra/x')).toBe(true)
        expect(canReachPath(closed, '/account')).toBe(true)
      })
    })
    it('registers its settings page: the page owns its subtree for capability, feature and landing', () => {
      const withSettings: AppManifest = { ...pilot, settings: { id: 'pilot', labelKey: 'nav.pilot', icon: 'i-lucide-handshake', to: '/settings/apps/pilot', parts: [{ id: 'pipeline', labelKey: 'pilot.settings', icon: 'i-lucide-handshake', capability: 'pilot.settings.manage' }] } }
      const admin = { capabilities: ['pilot.settings.manage'], platform: { readable_features: ['pilot.enabled'], writable_features: ['pilot.enabled'] } }
      const off = { ...admin, platform: { readable_features: ['hr.enabled'], writable_features: [] } }
      expect(requiredCapabilityForPath('/settings/apps/pilot')).toBeNull()
      withManifests([...appManifests, withSettings], () => {
        expect(requiredCapabilityForPath('/settings/apps/pilot/stages/3')).toBe('pilot.settings.manage')
        expect(featureForPath('/settings/apps/pilot')).toBe('pilot.enabled')
        expect(requiredCapabilityForPath('/settings/apps/pilot-other')).toBeNull()
        expect(canReachPath(admin, '/settings/apps/pilot/stages')).toBe(true)
        expect(canReachPath(off, '/settings/apps/pilot')).toBe(false)
        expect(canReachPath({ capabilities: [] }, '/settings/apps/pilot')).toBe(false)
        expect(firstAllowedPath(admin)).toBe('/settings/apps/pilot')
        expect(allNavItems().find(item => item.to === '/settings/apps/pilot#pipeline')).toMatchObject({ module: 'settings', group: 'settings', shortcut: '' })
      })
    })
    it('refuses a nested withManifests', () => {
      withManifests([pilot], () => {
        expect(() => withManifests([], () => 1)).toThrow(/already active/)
        expect(manifestForPath('/pilot')?.id).toBe('pilot')
      })
      expect(manifestForPath('/pilot')).toBeNull()
    })
    it('is removed again afterwards, even when the callback throws', () => {
      expect(() => withManifests([pilot], () => { throw new Error('boom') })).toThrow('boom')
      expect(manifestForPath('/pilot')).toBeNull()
      expect(manifestForPath('/hr')?.id).toBe('hr')
    })
  })
})

describe('palette declarations', () => {
  it('go keys are single letters, never g, and unique across applications and the foundation', () => {
    expect(goKeyProblems(allNavItems())).toEqual([])
    expect(allNavItems().flatMap(item => item.goKey ?? []).sort()).toEqual(['c', 'd', 'e', 'h', 'i', 'l', 'm', 'p', 'r', 't', 'u'])
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
      'chat.new-conversation', 'hr.new-employee', 'hr.new-department', 'documents.new-document',
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

  describe('HR context links', () => {
    const hr = appManifests.find(manifest => manifest.id === 'hr')!
    const links = (path: string) => hr.contextLinks!(path)

    it.each([
      ['/hr/recruitment', 'hr.new-applicant', '/hr/recruitment/new', 'hr.recruitment.manage'],
      ['/hr/shifts/schedules', 'hr.new-shift', '/hr/shifts/new', 'hr.shifts.manage'],
      ['/hr/onboarding', 'hr.new-onboarding', '/hr/onboarding/new', 'hr.onboarding.manage'],
      ['/hr/offboarding', 'hr.new-departure', '/hr/offboarding/new', 'hr.offboarding.manage'],
      ['/hr/assets', 'hr.new-asset', '/hr/assets/new', 'hr.assets.manage'],
      ['/hr/payroll/4', 'hr.new-payroll-run', '/hr/payroll/new', 'hr.payroll.manage'],
      ['/hr', 'hr.new-employee', '/hr/employees/new', 'hr.employees.manage'],
    ])('pins the own create action on %s', (path, commandId, to, capability) => {
      const pinned = links(path).filter(link => link.pinned)
      const command = hr.commands!.find(entry => entry.id === commandId)!
      expect(pinned).toHaveLength(1)
      expect(pinned[0]).toMatchObject({ to, capability, labelKey: command.labelKey })
    })

    it('pins the HR create link on the warnings area, and offers no palette command the server flag cannot gate', () => {
      expect(links('/hr/warnings/4').filter(link => link.pinned)).toMatchObject([{ id: 'new-warning', to: '/hr/warnings/new', capability: 'hr.warnings.manage' }])
      expect(hr.commands!.some(entry => entry.to === '/hr/warnings/new')).toBe(false)
    })

    it('keeps the four section links fixed and lists only the open section\'s pages under its heading', () => {
      const sectionIds = ['section-hiring', 'section-people', 'section-time', 'section-pay']
      const subIds = (path: string) => links(path).filter(link => link.section).map(link => link.id)
      for (const path of ['/hr', '/hr/recruitment/jobs', '/hr/leave', '/hr/payroll/4']) {
        expect(links(path).filter(link => link.id.startsWith('section-')).map(link => link.id), path).toEqual(sectionIds)
      }
      expect(subIds('/hr/recruitment/12')).toEqual(['recruitment', 'recruitment-jobs'])
      expect(subIds('/hr/employees/7')).toEqual(['employees', 'departments', 'onboarding', 'offboarding', 'assets', 'warnings', 'reports'])
      expect(subIds('/hr/shifts/schedules')).toEqual(['leave', 'shifts'])
      expect(subIds('/hr/payroll/4/gosi')).toEqual(['payroll'])
    })

    it('lights a section link on every page of its section only', () => {
      const lit = (path: string) => links(path).filter(link => link.id.startsWith('section-') && isContextLinkActive(path, link)).map(link => link.id)
      expect(lit('/hr/recruitment/jobs/new')).toEqual(['section-hiring'])
      expect(lit('/hr/departments/3')).toEqual(['section-people'])
      expect(lit('/hr/offboarding/5')).toEqual(['section-people'])
      expect(lit('/hr/shifts')).toEqual(['section-time'])
      expect(lit('/hr/payroll/4')).toEqual(['section-pay'])
    })

    it('lights the applicants page and the jobs page separately', () => {
      const lit = (path: string) => links(path).filter(link => link.section && isContextLinkActive(path, link)).map(link => link.id)
      expect(lit('/hr/recruitment')).toEqual(['recruitment'])
      expect(lit('/hr/recruitment/4')).toEqual(['recruitment'])
      expect(lit('/hr/recruitment/jobs')).toEqual(['recruitment-jobs'])
    })

    it.each([
      [['hr.employees.read'], ['hr.assets', 'hr.payroll'], []],
      [['hr.employees.read', 'hr.payroll.read'], ['hr.payroll'], ['payroll']],
      [['hr.employees.read', 'hr.payroll.read'], [], []],
    ])('shows the payroll links by capability and feature (%j, %j)', (capabilities, readable, expected) => {
      const user = { capabilities, platform: { readable_features: ['hr.enabled', ...readable], writable_features: ['hr.enabled', ...readable] } }
      const visible = ['/hr/payroll'].flatMap(path => contextLinksForModule('hr', user, path))
        .filter(link => ['payroll'].includes(link.id))
        .map(link => link.id)
      expect(visible).toEqual(expected)
    })

    it('lists the same pages in nav and in the context links', () => {
      const listed = ['/hr', '/hr/recruitment', '/hr/leave', '/hr/payroll']
        .flatMap(path => links(path).filter(link => link.section).map(link => link.to))
      expect(new Set(hr.nav.map(item => item.to))).toEqual(new Set(listed.filter(to => !['/account/assets', '/hr/recruitment/jobs'].includes(to))))
    })
  })
})
