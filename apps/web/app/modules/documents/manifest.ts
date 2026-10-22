import { DocumentListSchema, HrEmployeeSchema } from '@webvue/contracts'
import type { AppManifest } from '../types'
const manifest: AppManifest = {
  id: 'documents', feature: 'documents.enabled', routePrefixes: ['/documents', '/account/documents'],
  rail: [{ id: 'documents', labelKey: 'documents.title', icon: 'i-lucide-files', to: '/documents', order: 70 }],
  nav: [{ to: '/documents', labelKey: 'documents.title', icon: 'i-lucide-files', shortcut: '6', capability: 'documents.items.read' }],
  contextLinks: () => [
    { id: 'new-document', labelKey: 'documents.new', icon: 'i-lucide-plus', to: '/documents/new', capability: 'documents.items.manage', pinned: true },
    { id: 'documents', labelKey: 'documents.title', icon: 'i-lucide-files', to: '/documents', capability: 'documents.items.read' },
  ],
  landing: [{ path: '/documents', capability: 'documents.items.read' }],
  personal: [{
    id: 'documents', section: 'documents', labelKey: 'documents.personal.label', descriptionKey: 'documents.personal.description',
    icon: 'i-lucide-files', to: '/account/documents', capability: 'documents.items.read', feature: 'hr.enabled', requiredCapabilities: ['hr.employees.read'],
    summary: {
      queryKey: ['documents', 'employee', 'summary'],
      async load(api, t) {
        const employee = await api('/api/v1/hr/me', { schema: HrEmployeeSchema.nullable() })
        if (!employee) return { caption: t('documents.personal.noEmployee') }
        const result = await api('/api/v1/documents/employee/me', { query: { limit: 3 }, schema: DocumentListSchema })
        return { value: String(result.total), rows: result.items.map(item => ({ id: item.id, label: item.name, to: `/account/documents/${item.id}` })) }
      },
    },
  }],
  routeCapabilities: [
    { pattern: /^\/account\/documents(?:\/|$)/, capability: 'documents.items.read', feature: 'hr.enabled', requiredCapabilities: ['hr.employees.read'] },
    { pattern: /^\/documents\/new$/, capability: 'documents.items.manage' },
    { pattern: /^\/documents\/[^/]+\/edit$/, capability: 'documents.items.manage' },
    { pattern: /^\/documents\/[^/]+\/access$/, capability: 'documents.access.manage' },
    { pattern: /^\/documents(?:\/|$)/, capability: 'documents.items.read' },
  ],
  recordLinks: [{ kind: 'document', capability: 'documents.items.read', to: id => `/documents/${id}` }],
  recordListSources: [{ pattern: /^\/documents$/, capability: 'documents.items.read' }],
  commands: [{ id: 'documents.new-document', labelKey: 'documents.new', icon: 'i-lucide-files', to: '/documents/new', capability: 'documents.items.manage' }],
  isNavActive: (path, target) => target === '/documents' ? path === target || (path.startsWith(`${target}/`) && path !== '/documents/new') : undefined,
}
export default manifest
