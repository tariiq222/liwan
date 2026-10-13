import type { AppManifest } from '../types'

const manifest: AppManifest = {
  id: 'tasks',
  feature: 'tasks.enabled',
  routePrefixes: ['/my-tasks'],
  rail: [{ id: 'tasks', labelKey: 'myTasks.title', icon: 'i-lucide-layout-grid', to: '/my-tasks', order: 60 }],
  nav: [
    { to: '/my-tasks', labelKey: 'myTasks.nav.records', icon: 'i-lucide-layout-grid', shortcut: 'a', capability: 'tasks.tasks.read' },
  ],
  contextLinks: () => [
    { id: 'tasks-records', labelKey: 'myTasks.nav.records', icon: 'i-lucide-layout-grid', to: '/my-tasks', capability: 'tasks.tasks.read' },
  ],
  landing: [{ path: '/my-tasks', capability: 'tasks.tasks.read' }],
  routeCapabilities: [{ pattern: /^\/my-tasks(?:\/|$)/, capability: 'tasks.tasks.read' }],
}
export default manifest
