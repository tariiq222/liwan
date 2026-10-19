import type { AppManifest } from '../types'
const manifest: AppManifest = {
  id: 'operations', feature: 'operations.enabled', routePrefixes: ['/operations'],
  rail: [{ id: 'operations', labelKey: 'operations.title', icon: 'i-lucide-workflow', to: '/operations', order: 60, accent: 'orange' }],
  nav: [
    { to: '/operations', labelKey: 'operations.nav.mine', icon: 'i-lucide-files', shortcut: 'o', capability: 'operations.requests.read' },
    { to: '/operations/pending', labelKey: 'operations.nav.pending', icon: 'i-lucide-list-checks', shortcut: 'p', capability: 'operations.requests.review' },
    { to: '/operations/monitoring', labelKey: 'operations.nav.monitoring', icon: 'i-lucide-eye', shortcut: 'v', capability: 'operations.monitoring.read' },
    { to: '/operations/processes', labelKey: 'operations.nav.processes', icon: 'i-lucide-workflow', shortcut: 'x', capability: 'operations.processes.manage' },
  ],
  contextLinks: () => [
    { id: 'new-operation', labelKey: 'operations.newRequest', icon: 'i-lucide-plus', to: '/operations/new', capability: 'operations.requests.create', pinned: true },
    { id: 'operation-mine', labelKey: 'operations.nav.mine', icon: 'i-lucide-files', to: '/operations', capability: 'operations.requests.read' },
    { id: 'operation-pending', labelKey: 'operations.nav.pending', icon: 'i-lucide-list-checks', to: '/operations/pending', capability: 'operations.requests.review' },
    { id: 'operation-monitoring', labelKey: 'operations.nav.monitoring', icon: 'i-lucide-eye', to: '/operations/monitoring', capability: 'operations.monitoring.read' },
    { id: 'operation-processes', labelKey: 'operations.nav.processes', icon: 'i-lucide-workflow', to: '/operations/processes', capability: 'operations.processes.manage' },
  ],
  landing: [
    { path: '/operations', capability: 'operations.requests.read' },
    { path: '/operations/pending', capability: 'operations.requests.review' },
    { path: '/operations/monitoring', capability: 'operations.monitoring.read' },
    { path: '/operations/processes', capability: 'operations.processes.manage' },
  ],
  routeCapabilities: [
    { pattern: /^\/operations\/processes(?:\/|$)/, capability: 'operations.processes.manage' },
    { pattern: /^\/operations\/new$/, capability: 'operations.requests.create' },
    { pattern: /^\/operations\/[^/]+\/edit$/, capability: 'operations.requests.create' },
    { pattern: /^\/operations\/pending$/, capability: 'operations.requests.review' },
    { pattern: /^\/operations\/monitoring$/, capability: 'operations.monitoring.read' },
    { pattern: /^\/operations(?:\/|$)/, capability: 'operations.requests.read' },
  ],
  isNavActive(path, target) {
    if (target === '/operations') return path === '/operations' || /^\/operations\/\d+(?:\/|$)/.test(path)
    if (target === '/operations/processes') return path === target || path.startsWith(`${target}/`)
    if (target === '/operations/pending' || target === '/operations/monitoring') return path === target
    return undefined
  },
}
export default manifest
