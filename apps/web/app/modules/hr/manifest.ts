import type { AppContextLink, AppManifest } from '../types'
import { leaveApprovalAttention } from './attention'
import { hrSectionActive, hrSectionOf, hrSectionTarget, type HrSection } from './routes'

const plus = 'i-lucide-plus'
// Each area pins its own create action; the employee directory is the fallback.
const AREA_CREATE: Array<[prefix: string, link: AppContextLink]> = [
  ['/hr/leave', { id: 'new-leave', labelKey: 'hr.leave.new', icon: plus, to: '/hr/leave/new', capability: 'hr.leave.request', pinned: true }],
  ['/hr/departments', { id: 'new-department', labelKey: 'hr.depts.new', icon: plus, to: '/hr/departments/new', capability: 'hr.departments.manage', pinned: true }],
  ['/hr/recruitment', { id: 'new-applicant', labelKey: 'hrRecruitment.newApplicant', icon: plus, to: '/hr/recruitment/new', capability: 'hr.recruitment.manage', pinned: true }],
  ['/hr/shifts', { id: 'new-shift', labelKey: 'hrShifts.new', icon: plus, to: '/hr/shifts/new', capability: 'hr.shifts.manage', pinned: true }],
  ['/hr/onboarding', { id: 'new-onboarding', labelKey: 'hrOnboarding.runs.new', icon: plus, to: '/hr/onboarding/new', capability: 'hr.onboarding.manage', pinned: true }],
  ['/hr/offboarding', { id: 'new-departure', labelKey: 'hrOffboarding.departures.new', icon: plus, to: '/hr/offboarding/new', capability: 'hr.offboarding.manage', pinned: true }],
  ['/hr/assets', { id: 'new-asset', labelKey: 'hrAssets.new', icon: plus, to: '/hr/assets/new', capability: 'hr.assets.manage', pinned: true }],
  ['/hr/payroll', { id: 'new-payroll-run', labelKey: 'hrPayroll.runs.new', icon: plus, to: '/hr/payroll/new', capability: 'hr.payroll.manage', pinned: true }],
]
const NEW_EMPLOYEE: AppContextLink = { id: 'new-employee', labelKey: 'hr.directory.newEmployee', icon: plus, to: '/hr/employees/new', capability: 'hr.employees.manage', pinned: true }

function createLink(path?: string): AppContextLink {
  return AREA_CREATE.find(([prefix]) => path?.startsWith(prefix))?.[1] ?? NEW_EMPLOYEE
}

// The caller's own payslips are a page of their own: the runs entry does not claim them.
const PAYROLL_OWN_PAGES = ['/hr/payroll/mine']
const areaTargets = ['/hr/recruitment', '/hr/shifts', '/hr/onboarding', '/hr/offboarding', '/hr/assets']

const section = (id: HrSection, labelKey: string, icon: AppContextLink['icon'], to: string, capability: string, feature?: string): AppContextLink =>
  ({ id: `section-${id}`, labelKey, icon, to, capability, within: hrSectionTarget(id), ...(feature ? { feature } : {}) })

// Each section opens its first page. A section is hidden when the identity cannot open that page.
const SECTIONS: AppContextLink[] = [
  section('hiring', 'hr.nav.hiring', 'i-lucide-user-search', '/hr/recruitment', 'hr.recruitment.read'),
  section('people', 'hr.nav.people', 'i-lucide-users', '/hr', 'hr.employees.read'),
  section('time', 'hr.nav.time', 'i-lucide-calendar-clock', '/hr/leave', 'hr.leave.read'),
  section('pay', 'hr.nav.pay', 'i-lucide-banknote', '/hr/payroll', 'hr.payroll.read', 'hr.payroll'),
  section('mine', 'hr.nav.mine', 'i-lucide-user-round', '/hr/assets/mine', 'hr.employees.read'),
]

const page = (id: string, labelKey: string, icon: AppContextLink['icon'], to: string, capability: string, owner: HrSection, feature?: string): AppContextLink =>
  ({ id, labelKey, icon, to, capability, section: SECTIONS.find(link => link.id === `section-${owner}`)!.labelKey, ...(feature ? { feature } : {}) })

const SUB_LISTS: Record<HrSection, AppContextLink[]> = {
  hiring: [
    page('recruitment', 'hrRecruitment.applicants', 'i-lucide-user-search', '/hr/recruitment', 'hr.recruitment.read', 'hiring'),
    page('recruitment-jobs', 'hrRecruitment.jobs.title', 'i-lucide-briefcase', '/hr/recruitment/jobs', 'hr.recruitment.read', 'hiring'),
  ],
  people: [
    page('employees', 'nav.employees', 'i-lucide-users', '/hr', 'hr.employees.read', 'people'),
    page('departments', 'nav.departments', 'i-lucide-network', '/hr/departments', 'hr.departments.read', 'people'),
    page('onboarding', 'nav.onboarding', 'i-lucide-user-plus', '/hr/onboarding', 'hr.onboarding.read', 'people'),
    page('offboarding', 'nav.offboarding', 'i-lucide-user-minus', '/hr/offboarding', 'hr.offboarding.read', 'people'),
    page('assets', 'nav.assets', 'i-lucide-laptop', '/hr/assets', 'hr.assets.read', 'people'),
    page('reports', 'hr.reports.title', 'i-lucide-chart-pie', '/hr/reports', 'hr.employees.manage', 'people'),
  ],
  time: [
    page('leave', 'nav.leave', 'i-lucide-calendar-days', '/hr/leave', 'hr.leave.read', 'time'),
    page('shifts', 'nav.shifts', 'i-lucide-calendar-clock', '/hr/shifts', 'hr.shifts.read', 'time'),
  ],
  pay: [
    page('payroll', 'nav.payroll', 'i-lucide-banknote', '/hr/payroll', 'hr.payroll.read', 'pay', 'hr.payroll'),
  ],
  mine: [
    page('my-assets', 'nav.myAssets', 'i-lucide-package-check', '/hr/assets/mine', 'hr.employees.read', 'mine', 'hr.assets'),
    page('my-payslips', 'nav.myPayslips', 'i-lucide-receipt', '/hr/payroll/mine', 'hr.employees.read', 'mine', 'hr.payroll'),
  ],
}

const manifest: AppManifest = {
  id: 'hr',
  feature: 'hr.enabled',
  routePrefixes: ['/hr'],
  rail: [{ id: 'hr', labelKey: 'nav.hr', shortLabelKey: 'nav.rail.hr', icon: 'i-lucide-users', to: '/hr', order: 50 }],
  nav: [
    { to: '/hr', labelKey: 'nav.employees', icon: 'i-lucide-users', shortcut: '3', goKey: 'e', capability: 'hr.employees.read' },
    { to: '/hr/departments', labelKey: 'nav.departments', icon: 'i-lucide-network', shortcut: '5', goKey: 'd', capability: 'hr.departments.read' },
    { to: '/hr/recruitment', labelKey: 'nav.recruitment', icon: 'i-lucide-user-search', shortcut: '', capability: 'hr.recruitment.read' },
    { to: '/hr/onboarding', labelKey: 'nav.onboarding', icon: 'i-lucide-user-plus', shortcut: '', capability: 'hr.onboarding.read' },
    { to: '/hr/offboarding', labelKey: 'nav.offboarding', icon: 'i-lucide-user-minus', shortcut: '', capability: 'hr.offboarding.read' },
    { to: '/hr/leave', labelKey: 'nav.leave', icon: 'i-lucide-calendar-days', shortcut: 's', goKey: 'l', capability: 'hr.leave.read' },
    { to: '/hr/shifts', labelKey: 'nav.shifts', icon: 'i-lucide-calendar-clock', shortcut: '', capability: 'hr.shifts.read' },
    { to: '/hr/assets', labelKey: 'nav.assets', icon: 'i-lucide-laptop', shortcut: '', capability: 'hr.assets.read' },
    { to: '/hr/payroll', labelKey: 'nav.payroll', icon: 'i-lucide-banknote', shortcut: '', capability: 'hr.payroll.read' },
    { to: '/hr/reports', labelKey: 'hr.reports.title', icon: 'i-lucide-chart-pie', shortcut: 'r', capability: 'hr.employees.manage' },
  ],
  // The application's settings are one page under Settings > Applications; payroll is its first card.
  settings: {
    id: 'hr', labelKey: 'nav.hr', icon: 'i-lucide-users', to: '/settings/apps/hr',
    parts: [{ id: 'payroll', labelKey: 'hrPayroll.settings.title', icon: 'i-lucide-settings-2', capability: 'hr.payroll.config' }],
  },
  // The pinned create follows the open area. The five section links stay on screen in every page of the application;
  // the open section's pages follow in the sub-list card under its own heading.
  contextLinks: path => [createLink(path), ...SECTIONS, ...SUB_LISTS[hrSectionOf(path)]],
  landing: [
    { path: '/hr', capability: 'hr.employees.read' },
    { path: '/hr/departments', capability: 'hr.departments.read' },
    { path: '/hr/leave', capability: 'hr.leave.read' },
    { path: '/hr/recruitment', capability: 'hr.recruitment.read' },
    { path: '/hr/shifts', capability: 'hr.shifts.read' },
    { path: '/hr/onboarding', capability: 'hr.onboarding.read' },
    { path: '/hr/offboarding', capability: 'hr.offboarding.read' },
    { path: '/hr/assets', capability: 'hr.assets.read' },
    { path: '/hr/payroll', capability: 'hr.payroll.read' },
  ],
  attention: [leaveApprovalAttention],
  commands: [
    { id: 'hr.new-employee', labelKey: 'hr.directory.newEmployee', icon: 'i-lucide-users', to: '/hr/employees/new', capability: 'hr.employees.manage' },
    { id: 'hr.new-department', labelKey: 'hr.depts.new', icon: 'i-lucide-network', to: '/hr/departments/new', capability: 'hr.departments.manage' },
    { id: 'hr.new-leave', labelKey: 'hr.leave.new', icon: 'i-lucide-calendar-days', to: '/hr/leave/new', capability: 'hr.leave.request' },
    { id: 'hr.new-applicant', labelKey: 'hrRecruitment.newApplicant', icon: 'i-lucide-user-search', to: '/hr/recruitment/new', capability: 'hr.recruitment.manage' },
    { id: 'hr.new-shift', labelKey: 'hrShifts.new', icon: 'i-lucide-calendar-clock', to: '/hr/shifts/new', capability: 'hr.shifts.manage' },
    { id: 'hr.new-onboarding', labelKey: 'hrOnboarding.runs.new', icon: 'i-lucide-user-plus', to: '/hr/onboarding/new', capability: 'hr.onboarding.manage' },
    { id: 'hr.new-departure', labelKey: 'hrOffboarding.departures.new', icon: 'i-lucide-user-minus', to: '/hr/offboarding/new', capability: 'hr.offboarding.manage' },
    { id: 'hr.new-asset', labelKey: 'hrAssets.new', icon: 'i-lucide-laptop', to: '/hr/assets/new', capability: 'hr.assets.manage' },
    { id: 'hr.new-payroll-run', labelKey: 'hrPayroll.runs.new', icon: 'i-lucide-banknote', to: '/hr/payroll/new', capability: 'hr.payroll.manage' },
  ],
  subFeatures: {
    'hr.recruitment.': 'hr.recruitment',
    'hr.shifts.': 'hr.shifts',
    'hr.onboarding.': 'hr.onboarding',
    'hr.offboarding.': 'hr.offboarding',
    'hr.assets.': 'hr.assets',
    'hr.payroll.': 'hr.payroll',
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
    { pattern: /^\/hr\/reports$/, capability: 'hr.employees.manage' },
    { pattern: /^\/hr\/employees\/[^/]+\/compensation$/, capability: 'hr.payroll.manage', feature: 'hr.payroll' },
    { pattern: /^\/hr\/payroll\/new$/, capability: 'hr.payroll.manage', feature: 'hr.payroll' },
    // The caller's own approved payslips are an employee read, not a payroll-area read.
    { pattern: /^\/hr\/payroll\/mine(?:\/[^/]+)?$/, capability: 'hr.employees.read', feature: 'hr.payroll' },
    { pattern: /^\/hr\/payroll(?:\/|$)/, capability: 'hr.payroll.read', feature: 'hr.payroll' },
    { pattern: /^\/hr\/employees\/(new|[^/]+\/edit)$/, capability: 'hr.employees.manage' },
    { pattern: /^\/hr\/departments\/(new|[^/]+\/edit)$/, capability: 'hr.departments.manage' },
    { pattern: /^\/hr\/employees\/[^/]+\/access$/, capability: 'access.users.grant' },
  ],
  isNavActive(path, target) {
    const inSection = hrSectionActive(path, target)
    if (inSection !== undefined) return inSection
    // Create forms (`.../new`) belong to the pinned create link, not to a list entry.
    if (target === '/hr') return path === '/hr' || (path.startsWith('/hr/employees/') && path !== '/hr/employees/new')
    // The own-custody page is its own entry: the assets area does not claim it.
    if (target === '/hr/assets/mine') return path === target
    if (target === '/hr/assets' && path === '/hr/assets/mine') return false
    if (PAYROLL_OWN_PAGES.includes(target)) return path === target || (target === '/hr/payroll/mine' && path.startsWith(`${target}/`))
    if (target === '/hr/payroll') return path === target || (path.startsWith(`${target}/`) && !PAYROLL_OWN_PAGES.some(own => path === own || path.startsWith(`${own}/`)))
    // The applicants page is the recruitment list; the jobs pages are their own entry.
    if (target === '/hr/recruitment') return path === target || (path.startsWith(`${target}/`) && !path.startsWith('/hr/recruitment/jobs'))
    if (target === '/hr/recruitment/jobs') return path === target || path.startsWith(`${target}/`)
    if (areaTargets.includes(target)) return path === target || path.startsWith(`${target}/`)
    if (target === '/hr/leave') return path === target || path === '/hr/leave/allocations/new'
    if (target === '/hr/departments') return path === target || (path.startsWith(`${target}/`) && path !== '/hr/departments/new')
    return undefined
  },
}
export default manifest
