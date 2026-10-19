import type { AppContextLink, AppManifest } from '../types'

const departmentDocuments = (path: string) => /^\/hr\/departments\/[^/]+\/documents(?:\/|$)/.test(path)

function createLink(path?: string): AppContextLink {
  if (path?.startsWith('/hr/leave')) {
    return { id: 'new-leave', labelKey: 'hr.leave.new', icon: 'i-lucide-plus', to: '/hr/leave/new', capability: 'hr.leave.request', pinned: true }
  }
  if (path?.startsWith('/hr/documents') || departmentDocuments(path ?? '')) {
    return { id: 'new-document', labelKey: 'hr.docs.new', icon: 'i-lucide-plus', to: '/hr/documents/new', capability: 'hr.documents.manage', pinned: true }
  }
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
    { to: '/hr/documents', labelKey: 'nav.documents', icon: 'i-lucide-files', shortcut: '6', capability: 'hr.documents.read' },
    { to: '/hr/leave', labelKey: 'nav.leave', icon: 'i-lucide-calendar-days', shortcut: 's', goKey: 'l', capability: 'hr.leave.read' },
  ],
  // The pinned create follows the page: documents, departments, otherwise employees.
  contextLinks: path => [
    createLink(path),
    { id: 'employees', labelKey: 'nav.employees', icon: 'i-lucide-users', to: '/hr', capability: 'hr.employees.read' },
    { id: 'departments', labelKey: 'nav.departments', icon: 'i-lucide-network', to: '/hr/departments', capability: 'hr.departments.read' },
    { id: 'documents', labelKey: 'nav.documents', icon: 'i-lucide-files', to: '/hr/documents', capability: 'hr.documents.read' },
    { id: 'leave', labelKey: 'nav.leave', icon: 'i-lucide-calendar-days', to: '/hr/leave', capability: 'hr.leave.read' },
  ],
  landing: [
    { path: '/hr', capability: 'hr.employees.read' },
    { path: '/hr/departments', capability: 'hr.departments.read' },
    { path: '/hr/documents', capability: 'hr.documents.read' },
    { path: '/hr/leave', capability: 'hr.leave.read' },
  ],
  commands: [
    { id: 'hr.new-employee', labelKey: 'hr.directory.newEmployee', icon: 'i-lucide-users', to: '/hr/employees/new', capability: 'hr.employees.manage' },
    { id: 'hr.new-department', labelKey: 'hr.depts.new', icon: 'i-lucide-network', to: '/hr/departments/new', capability: 'hr.departments.manage' },
    { id: 'hr.new-document', labelKey: 'hr.docs.new', icon: 'i-lucide-files', to: '/hr/documents/new', capability: 'hr.documents.manage' },
    { id: 'hr.new-leave', labelKey: 'hr.leave.new', icon: 'i-lucide-calendar-days', to: '/hr/leave/new', capability: 'hr.leave.request' },
  ],
  routeCapabilities: [
    { pattern: /^\/hr\/leave\/new$/, capability: 'hr.leave.request' },
    { pattern: /^\/hr\/leave\/allocations\/new$/, capability: 'hr.leave.manage' },
    { pattern: /^\/hr\/leave(?:\/|$)/, capability: 'hr.leave.read' },
    { pattern: /^\/hr\/documents\/new$/, capability: 'hr.documents.manage' },
    { pattern: /^\/hr\/departments\/[^/]+\/documents\/(?:[^/]+\/)*(?:new|edit)$/, capability: 'hr.documents.manage' },
    { pattern: /^\/hr\/departments\/[^/]+\/documents(?:\/|$)/, capability: 'hr.documents.read' },
    { pattern: /^\/hr\/employees\/(new|[^/]+\/edit)$/, capability: 'hr.employees.manage' },
    { pattern: /^\/hr\/departments\/(new|[^/]+\/edit)$/, capability: 'hr.departments.manage' },
    { pattern: /^\/hr\/employees\/[^/]+\/access$/, capability: 'access.users.grant' },
  ],
  isNavActive(path, target) {
    // Create forms (`.../new`) belong to the pinned create link, not to a list entry.
    if (target === '/hr') return path === '/hr' || (path.startsWith('/hr/employees/') && path !== '/hr/employees/new')
    if (target === '/hr/leave') return path === target || path === '/hr/leave/allocations/new'
    if (target === '/hr/documents') return path === target || (path.startsWith(`${target}/`) && path !== '/hr/documents/new') || departmentDocuments(path)
    if (target === '/hr/departments') return path === target || (path.startsWith(`${target}/`) && path !== '/hr/departments/new' && !/\/documents(?:\/|$)/.test(path))
    return undefined
  },
}
export default manifest
