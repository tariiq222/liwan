import type { AppContextLink, AppManifest } from '../types'

function createLink(path?: string): AppContextLink {
  if (path?.startsWith('/hr/leave')) {
    return { id: 'new-leave', labelKey: 'hr.leave.new', icon: 'i-lucide-plus', to: '/hr/leave/new', capability: 'hr.leave.request', pinned: true }
  }
  if (path?.startsWith('/hr/departments')) {
    return { id: 'new-department', labelKey: 'hr.depts.new', icon: 'i-lucide-plus', to: '/hr/departments/new', capability: 'hr.departments.manage', pinned: true }
  }
  return { id: 'new-employee', labelKey: 'hr.directory.newEmployee', icon: 'i-lucide-plus', to: '/hr/employees/new', capability: 'hr.employees.manage', pinned: true }
}

const areaTargets = ['/hr/recruitment', '/hr/shifts', '/hr/onboarding', '/hr/offboarding', '/hr/assets']

const manifest: AppManifest = {
  id: 'hr',
  feature: 'hr.enabled',
  routePrefixes: ['/hr'],
  rail: [{ id: 'hr', labelKey: 'nav.hr', icon: 'i-lucide-users', to: '/hr', order: 50 }],
  nav: [
    { to: '/hr', labelKey: 'nav.employees', icon: 'i-lucide-users', shortcut: '3', goKey: 'e', capability: 'hr.employees.read' },
    { to: '/hr/departments', labelKey: 'nav.departments', icon: 'i-lucide-network', shortcut: '5', goKey: 'd', capability: 'hr.departments.read' },
    { to: '/hr/leave', labelKey: 'nav.leave', icon: 'i-lucide-calendar-days', shortcut: 's', goKey: 'l', capability: 'hr.leave.read' },
    { to: '/hr/recruitment', labelKey: 'nav.recruitment', icon: 'i-lucide-user-search', shortcut: '0', capability: 'hr.recruitment.read' },
    { to: '/hr/shifts', labelKey: 'nav.shifts', icon: 'i-lucide-calendar-clock', shortcut: 'e', capability: 'hr.shifts.read' },
    { to: '/hr/onboarding', labelKey: 'nav.onboarding', icon: 'i-lucide-user-plus', shortcut: 'r', capability: 'hr.onboarding.read' },
    { to: '/hr/offboarding', labelKey: 'nav.offboarding', icon: 'i-lucide-user-minus', shortcut: 't', capability: 'hr.offboarding.read' },
    { to: '/hr/assets', labelKey: 'nav.assets', icon: 'i-lucide-laptop', shortcut: '', capability: 'hr.assets.read' },
  ],
  // The pinned create follows departments or the employee directory.
  contextLinks: path => [
    createLink(path),
    { id: 'employees', labelKey: 'nav.employees', icon: 'i-lucide-users', to: '/hr', capability: 'hr.employees.read' },
    { id: 'departments', labelKey: 'nav.departments', icon: 'i-lucide-network', to: '/hr/departments', capability: 'hr.departments.read' },
    { id: 'leave', labelKey: 'nav.leave', icon: 'i-lucide-calendar-days', to: '/hr/leave', capability: 'hr.leave.read' },
    { id: 'recruitment', labelKey: 'nav.recruitment', icon: 'i-lucide-user-search', to: '/hr/recruitment', capability: 'hr.recruitment.read' },
    { id: 'shifts', labelKey: 'nav.shifts', icon: 'i-lucide-calendar-clock', to: '/hr/shifts', capability: 'hr.shifts.read' },
    { id: 'onboarding', labelKey: 'nav.onboarding', icon: 'i-lucide-user-plus', to: '/hr/onboarding', capability: 'hr.onboarding.read' },
    { id: 'offboarding', labelKey: 'nav.offboarding', icon: 'i-lucide-user-minus', to: '/hr/offboarding', capability: 'hr.offboarding.read' },
    { id: 'assets', labelKey: 'nav.assets', icon: 'i-lucide-laptop', to: '/hr/assets', capability: 'hr.assets.read' },
    { id: 'my-assets', labelKey: 'nav.myAssets', icon: 'i-lucide-package-check', to: '/hr/assets/mine', capability: 'hr.employees.read', feature: 'hr.assets' },
  ],
  landing: [
    { path: '/hr', capability: 'hr.employees.read' },
    { path: '/hr/departments', capability: 'hr.departments.read' },
    { path: '/hr/leave', capability: 'hr.leave.read' },
    { path: '/hr/recruitment', capability: 'hr.recruitment.read' },
    { path: '/hr/shifts', capability: 'hr.shifts.read' },
    { path: '/hr/onboarding', capability: 'hr.onboarding.read' },
    { path: '/hr/offboarding', capability: 'hr.offboarding.read' },
    { path: '/hr/assets', capability: 'hr.assets.read' },
  ],
  commands: [
    { id: 'hr.new-employee', labelKey: 'hr.directory.newEmployee', icon: 'i-lucide-users', to: '/hr/employees/new', capability: 'hr.employees.manage' },
    { id: 'hr.new-department', labelKey: 'hr.depts.new', icon: 'i-lucide-network', to: '/hr/departments/new', capability: 'hr.departments.manage' },
    { id: 'hr.new-leave', labelKey: 'hr.leave.new', icon: 'i-lucide-calendar-days', to: '/hr/leave/new', capability: 'hr.leave.request' },
    { id: 'hr.new-applicant', labelKey: 'hrRecruitment.newApplicant', icon: 'i-lucide-user-search', to: '/hr/recruitment/new', capability: 'hr.recruitment.manage' },
    { id: 'hr.new-shift', labelKey: 'hrShifts.new', icon: 'i-lucide-calendar-clock', to: '/hr/shifts/new', capability: 'hr.shifts.manage' },
    { id: 'hr.new-onboarding', labelKey: 'hrOnboarding.runs.new', icon: 'i-lucide-user-plus', to: '/hr/onboarding/new', capability: 'hr.onboarding.manage' },
    { id: 'hr.new-departure', labelKey: 'hrOffboarding.departures.new', icon: 'i-lucide-user-minus', to: '/hr/offboarding/new', capability: 'hr.offboarding.manage' },
    { id: 'hr.new-asset', labelKey: 'hrAssets.new', icon: 'i-lucide-laptop', to: '/hr/assets/new', capability: 'hr.assets.manage' },
  ],
  subFeatures: {
    'hr.recruitment.': 'hr.recruitment',
    'hr.shifts.': 'hr.shifts',
    'hr.onboarding.': 'hr.onboarding',
    'hr.offboarding.': 'hr.offboarding',
    'hr.assets.': 'hr.assets',
  },
  routeCapabilities: [
    { pattern: /^\/hr\/recruitment\/(?:.+\/)?new$/, capability: 'hr.recruitment.manage' },
    { pattern: /^\/hr\/recruitment(?:\/|$)/, capability: 'hr.recruitment.read' },
    { pattern: /^\/hr\/shifts\/(?:.+\/)?new$/, capability: 'hr.shifts.manage' },
    { pattern: /^\/hr\/shifts(?:\/|$)/, capability: 'hr.shifts.read' },
    { pattern: /^\/hr\/onboarding\/(?:.+\/)?new$/, capability: 'hr.onboarding.manage' },
    { pattern: /^\/hr\/onboarding(?:\/|$)/, capability: 'hr.onboarding.read' },
    { pattern: /^\/hr\/offboarding\/(?:.+\/)?new$/, capability: 'hr.offboarding.manage' },
    { pattern: /^\/hr\/offboarding(?:\/|$)/, capability: 'hr.offboarding.read' },
    { pattern: /^\/hr\/assets\/(?:.+\/)?new$/, capability: 'hr.assets.manage' },
    // The caller's own custody is an employee read, not an assets-area read.
    { pattern: /^\/hr\/assets\/mine$/, capability: 'hr.employees.read', feature: 'hr.assets' },
    { pattern: /^\/hr\/assets(?:\/|$)/, capability: 'hr.assets.read' },
    { pattern: /^\/hr\/leave\/new$/, capability: 'hr.leave.request' },
    { pattern: /^\/hr\/leave\/allocations\/new$/, capability: 'hr.leave.manage' },
    { pattern: /^\/hr\/leave(?:\/|$)/, capability: 'hr.leave.read' },
    { pattern: /^\/hr\/employees\/(new|[^/]+\/edit)$/, capability: 'hr.employees.manage' },
    { pattern: /^\/hr\/departments\/(new|[^/]+\/edit)$/, capability: 'hr.departments.manage' },
    { pattern: /^\/hr\/employees\/[^/]+\/access$/, capability: 'access.users.grant' },
  ],
  isNavActive(path, target) {
    // Create forms (`.../new`) belong to the pinned create link, not to a list entry.
    if (target === '/hr') return path === '/hr' || (path.startsWith('/hr/employees/') && path !== '/hr/employees/new')
    // The own-custody page is its own entry: the assets area does not claim it.
    if (target === '/hr/assets/mine') return path === target
    if (target === '/hr/assets' && path === '/hr/assets/mine') return false
    if (areaTargets.includes(target)) return path === target || path.startsWith(`${target}/`)
    if (target === '/hr/leave') return path === target || path === '/hr/leave/allocations/new'
    if (target === '/hr/departments') return path === target || (path.startsWith(`${target}/`) && path !== '/hr/departments/new')
    return undefined
  },
}
export default manifest
