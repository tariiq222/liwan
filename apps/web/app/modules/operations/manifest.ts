import type { AppManifest } from '../types'
import { operationPersonalEntry } from './personal'
const manifest: AppManifest = {
  id: 'operations', feature: 'operations.enabled', routePrefixes: ['/operations', '/account/requests'],
  rail: [{ id: 'operations', labelKey: 'operations.title', icon: 'i-lucide-workflow', to: '/operations', order: 60 }],
  nav: [
    { to: '/operations', labelKey: 'operations.nav.mine', icon: 'i-lucide-files', shortcut: 'o', capability: 'operations.requests.read' },
    { to: '/operations/pending', labelKey: 'operations.nav.pending', icon: 'i-lucide-list-checks', shortcut: 'p', capability: 'operations.requests.review' },
    { to: '/operations/monitoring', labelKey: 'operations.nav.monitoring', icon: 'i-lucide-eye', shortcut: 'v', capability: 'operations.monitoring.read' },
  ],
  settings: {
    id: 'operations', labelKey: 'operations.title', icon: 'i-lucide-workflow', to: '/settings/apps/operations/processes',
    parts: [{ id: 'processes', labelKey: 'operations.nav.processes', icon: 'i-lucide-workflow', capability: 'operations.processes.manage' }],
  },
  contextLinks: () => [
    { id: 'new-operation', labelKey: 'operations.newRequest', icon: 'i-lucide-plus', to: '/operations/new', capability: 'operations.requests.create', pinned: true },
    { id: 'operation-mine', labelKey: 'operations.nav.mine', icon: 'i-lucide-files', to: '/operations', capability: 'operations.requests.read' },
    { id: 'operation-pending', labelKey: 'operations.nav.pending', icon: 'i-lucide-list-checks', to: '/operations/pending', capability: 'operations.requests.review' },
    { id: 'operation-monitoring', labelKey: 'operations.nav.monitoring', icon: 'i-lucide-eye', to: '/operations/monitoring', capability: 'operations.monitoring.read' },
  ],
  landing: [
    { path: '/operations', capability: 'operations.requests.read' },
    { path: '/operations/pending', capability: 'operations.requests.review' },
    { path: '/operations/monitoring', capability: 'operations.monitoring.read' },
  ],
  routeCapabilities: [
    { pattern: /^\/account\/requests\/new$/, capability: 'operations.requests.create' },
    { pattern: /^\/account\/requests\/[^/]+\/edit$/, capability: 'operations.requests.create' },
    { pattern: /^\/account\/requests(?:\/|$)/, capability: 'operations.requests.read' },
    { pattern: /^\/operations\/new$/, capability: 'operations.requests.create' },
    { pattern: /^\/operations\/[^/]+\/edit$/, capability: 'operations.requests.create' },
    { pattern: /^\/operations\/pending$/, capability: 'operations.requests.review' },
    { pattern: /^\/operations\/monitoring$/, capability: 'operations.monitoring.read' },
    { pattern: /^\/operations(?:\/|$)/, capability: 'operations.requests.read' },
  ],
  personal: [operationPersonalEntry],
  isNavActive(path, target) {
    if (target === '/operations') return path === '/operations' || /^\/operations\/\d+(?:\/|$)/.test(path)
    if (target === '/operations/pending' || target === '/operations/monitoring') return path === target
    return undefined
  },
}
export default manifest
