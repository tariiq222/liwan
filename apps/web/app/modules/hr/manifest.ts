import type { AppManifest } from '../types'

const departmentDocuments = (path: string) => /^\/hr\/departments\/[^/]+\/documents(?:\/|$)/.test(path)

const manifest: AppManifest = {
  id: 'hr',
  feature: 'hr.enabled',
  routePrefixes: ['/hr'],
  rail: [{ id: 'hr', labelKey: 'nav.organization', icon: 'i-lucide-users', to: '/hr', order: 50 }],
  nav: [],
  landing: [
    { path: '/hr', capability: 'hr.employees.read' },
    { path: '/hr/departments', capability: 'hr.departments.read' },
    { path: '/hr/documents', capability: 'hr.documents.read' },
  ],
  routeCapabilities: [
    { pattern: /^\/hr\/documents\/new$/, capability: 'hr.documents.manage' },
    { pattern: /^\/hr\/departments\/[^/]+\/documents\/(?:[^/]+\/)*(?:new|edit)$/, capability: 'hr.documents.manage' },
    { pattern: /^\/hr\/departments\/[^/]+\/documents(?:\/|$)/, capability: 'hr.documents.read' },
    { pattern: /^\/hr\/employees\/(new|[^/]+\/edit)$/, capability: 'hr.employees.manage' },
    { pattern: /^\/hr\/departments\/(new|[^/]+\/edit)$/, capability: 'hr.departments.manage' },
    { pattern: /^\/hr\/employees\/[^/]+\/access$/, capability: 'access.users.grant' },
  ],
  isNavActive(path, target) {
    if (target === '/hr') return path === '/hr' || path.startsWith('/hr/employees/')
    if (target === '/hr/documents') return path === target || path.startsWith(`${target}/`) || departmentDocuments(path)
    if (target === '/hr/departments' && departmentDocuments(path)) return false
    return undefined
  },
}
export default manifest
