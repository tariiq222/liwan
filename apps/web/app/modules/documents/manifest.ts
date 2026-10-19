import type { AppManifest } from '../types'
const manifest: AppManifest = {
  id: 'documents', feature: 'documents.enabled', routePrefixes: ['/documents'],
  rail: [{ id: 'documents', labelKey: 'documents.title', icon: 'i-lucide-files', to: '/documents', order: 70 }],
  nav: [{ to: '/documents', labelKey: 'documents.title', icon: 'i-lucide-files', shortcut: '6', capability: 'documents.items.read' }],
  contextLinks: () => [
    { id: 'new-document', labelKey: 'documents.new', icon: 'i-lucide-plus', to: '/documents/new', capability: 'documents.items.manage', pinned: true },
    { id: 'documents', labelKey: 'documents.title', icon: 'i-lucide-files', to: '/documents', capability: 'documents.items.read' },
  ],
  landing: [{ path: '/documents', capability: 'documents.items.read' }],
  routeCapabilities: [
    { pattern: /^\/documents\/new$/, capability: 'documents.items.manage' },
    { pattern: /^\/documents\/[^/]+\/edit$/, capability: 'documents.items.manage' },
    { pattern: /^\/documents\/[^/]+\/access$/, capability: 'documents.access.manage' },
    { pattern: /^\/documents(?:\/|$)/, capability: 'documents.items.read' },
  ],
  recordListSources: [{ pattern: /^\/documents$/, capability: 'documents.items.read' }],
  commands: [{ id: 'documents.new-document', labelKey: 'documents.new', icon: 'i-lucide-files', to: '/documents/new', capability: 'documents.items.manage' }],
  isNavActive: (path, target) => target === '/documents' ? path === target || (path.startsWith(`${target}/`) && path !== '/documents/new') : undefined,
}
export default manifest
