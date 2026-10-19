import type { AppContextLink, AppManifest } from '../types'

function createLink(path?: string): AppContextLink {
  if (path?.startsWith('/hr/departments')) {
    return { id: 'new-department', labelKey: 'hr.depts.new', icon: 'i-lucide-plus', to: '/hr/departments/new', capability: 'hr.departments.manage', pinned: true }
  }
  return { id: 'new-employee', labelKey: 'hr.directory.newEmployee', icon: 'i-lucide-plus', to: '/hr/employees/new', capability: 'hr.employees.manage', pinned: true }
}

const manifest: AppManifest = {
  id: 'hr',
  feature: 'hr.enabled',
  routePrefixes: ['/hr'],
  rail: [{ id: 'hr', labelKey: 'nav.hr', icon: 'i-lucide-users', to: '/hr', order: 50 }],
  nav: [
    { to: '/hr', labelKey: 'nav.employees', icon: 'i-lucide-users', shortcut: '3', goKey: 'e', capability: 'hr.employees.read' },
    { to: '/hr/departments', labelKey: 'nav.departments', icon: 'i-lucide-network', shortcut: '5', goKey: 'd', capability: 'hr.departments.read' },
  ],
  // The pinned create follows departments or the employee directory.
  contextLinks: path => [
    createLink(path),
    { id: 'employees', labelKey: 'nav.employees', icon: 'i-lucide-users', to: '/hr', capability: 'hr.employees.read' },
    { id: 'departments', labelKey: 'nav.departments', icon: 'i-lucide-network', to: '/hr/departments', capability: 'hr.departments.read' },
  ],
  landing: [
    { path: '/hr', capability: 'hr.employees.read' },
    { path: '/hr/departments', capability: 'hr.departments.read' },
  ],
  commands: [
    { id: 'hr.new-employee', labelKey: 'hr.directory.newEmployee', icon: 'i-lucide-users', to: '/hr/employees/new', capability: 'hr.employees.manage' },
    { id: 'hr.new-department', labelKey: 'hr.depts.new', icon: 'i-lucide-network', to: '/hr/departments/new', capability: 'hr.departments.manage' },
  ],
  routeCapabilities: [
    { pattern: /^\/hr\/employees\/(new|[^/]+\/edit)$/, capability: 'hr.employees.manage' },
    { pattern: /^\/hr\/departments\/(new|[^/]+\/edit)$/, capability: 'hr.departments.manage' },
    { pattern: /^\/hr\/employees\/[^/]+\/access$/, capability: 'access.users.grant' },
  ],
  isNavActive(path, target) {
    // Create forms (`.../new`) belong to the pinned create link, not to a list entry.
    if (target === '/hr') return path === '/hr' || (path.startsWith('/hr/employees/') && path !== '/hr/employees/new')
    if (target === '/hr/departments') return path === target || (path.startsWith(`${target}/`) && path !== '/hr/departments/new')
    return undefined
  },
}
export default manifest
