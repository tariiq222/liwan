import type { AppManifest } from '../types'

const isProjectSettings = (path: string) => path === '/projects/settings' || path.startsWith('/projects/settings/')

const manifest: AppManifest = {
  id: 'pmo',
  feature: 'pmo.enabled',
  routePrefixes: ['/projects', '/tasks', '/project-templates', '/reports', '/archived-tasks'],
  rail: [
    { id: 'home', labelKey: 'nav.home', icon: 'i-lucide-house', to: '/projects/dashboard', order: 10 },
    { id: 'projects', labelKey: 'nav.projects', icon: 'i-lucide-folder-kanban', to: '/projects', order: 20 },
  ],
  nav: [],
  landing: [
    { path: '/projects/dashboard', capability: 'pmo.projects.read' },
    { path: '/tasks', capability: 'pmo.tasks.read' },
    { path: '/projects', capability: 'pmo.projects.read' },
    { path: '/project-templates', capability: 'pmo.projects.read' },
    { path: '/reports', capability: 'pmo.projects.read' },
    { path: '/projects/settings', capability: 'pmo.settings.manage', late: true },
  ],
  routeCapabilities: [
    { pattern: /^\/projects\/settings(?:\/|$)/, capability: 'pmo.settings.manage' },
    { pattern: /^\/project-templates\/(new|[^/]+\/edit)$/, capability: 'pmo.settings.manage' },
    { pattern: /^\/archived-tasks$/, capability: 'pmo.tasks.read' },
    { pattern: /^\/tasks\/new$/, capability: 'pmo.tasks.create' },
    { pattern: /^\/projects\/[^/]+\/tasks\/new$/, capability: 'pmo.tasks.create' },
    { pattern: /^\/projects\/new$/, capability: 'pmo.projects.create' },
  ],
  bell: { capabilities: ['pmo.tasks.read'] },
  returnToPaths: ['/archived-tasks'],
  isNavActive(path, target) {
    if (target !== '/projects') return undefined
    if (path === '/projects/dashboard' || path.startsWith('/projects/dashboard/')) return false
    if (isProjectSettings(path)) return false
    return undefined
  },
}
export default manifest
