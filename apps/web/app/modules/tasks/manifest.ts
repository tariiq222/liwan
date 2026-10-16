import type { AppManifest } from '../types'

const manifest: AppManifest = {
  id: 'tasks',
  feature: 'tasks.enabled',
  routePrefixes: ['/my-tasks'],
  // Order 15 puts «مهامي» before the PMO projects entry (20) and after the home entry (10).
  rail: [{ id: 'tasks', labelKey: 'nav.myTasks', icon: 'i-lucide-check-square', to: '/my-tasks', order: 15 }],
  nav: [
    { to: '/my-tasks', labelKey: 'nav.myTasks', icon: 'i-lucide-check-square', shortcut: 'a', capability: 'tasks.tasks.read' },
  ],
  contextLinks: () => [
    { id: 'new-task', labelKey: 'myTasks.new', icon: 'i-lucide-plus', to: '/my-tasks/new', capability: 'tasks.tasks.create', pinned: true },
  ],
  landing: [{ path: '/my-tasks', capability: 'tasks.tasks.read' }],
  routeCapabilities: [{ pattern: /^\/my-tasks\/new$/, capability: 'tasks.tasks.create' }],
  bell: {
    capabilities: ['tasks.tasks.read'],
    kinds: [{
      kind: 'tasks.assigned',
      href: row => `/my-tasks/${row.task_id}`,
      title: row => String(row.title ?? row.task_name),
    }],
  },
}
export default manifest
