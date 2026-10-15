import { ProjectNotificationKindSchema, TaskNotificationKindSchema } from '@nasq/contracts'
import type { AppManifest } from '../types'
import { projectsSearch, tasksSearch } from './search'

const isProjectSettings = (path: string) => path === '/projects/settings' || path.startsWith('/projects/settings/')

const manifest: AppManifest = {
  id: 'pmo',
  feature: 'pmo.enabled',
  routePrefixes: ['/projects', '/tasks'],
  rail: [
    { id: 'home', labelKey: 'nav.home', icon: 'i-lucide-house', to: '/projects/dashboard', order: 10 },
    { id: 'projects', labelKey: 'nav.projects', icon: 'i-lucide-folder-kanban', to: '/projects', order: 20 },
  ],
  defaultRail: 'projects',
  nav: [
    { to: '/projects/dashboard', labelKey: 'nav.home', icon: 'i-lucide-house', shortcut: 'h', goKey: 'h', capability: 'pmo.projects.read', module: 'home' },
    { to: '/projects', labelKey: 'nav.projects', icon: 'i-lucide-folder-kanban', shortcut: '2', goKey: 'p', capability: 'pmo.projects.read', module: 'projects' },
    { to: '/tasks', labelKey: 'nav.tasks', icon: 'i-lucide-check-square', shortcut: '1', goKey: 't', capability: 'pmo.tasks.read', module: 'projects' },
    { to: '/projects/settings', labelKey: 'settings.projects.title', icon: 'i-lucide-settings', shortcut: '4', capability: 'pmo.settings.manage', module: 'projects' },
  ],
  // Shown for `home` and `projects`, including inside a project (2026-09-11). Project settings close
  // the sidebar (user decision 2026-09-16); they are not a settings-module page.
  contextLinks: () => [
    { id: 'new-project', labelKey: 'nav.newProject', icon: 'i-lucide-plus', to: '/projects/new', capability: 'pmo.projects.create', pinned: true },
    { id: 'project-dashboard', labelKey: 'nav.projectDashboard', icon: 'i-lucide-chart-no-axes-combined', to: '/projects/dashboard', capability: 'pmo.projects.read' },
    { id: 'projects', labelKey: 'nav.allProjects', icon: 'i-lucide-folder-kanban', to: '/projects', capability: 'pmo.projects.read' },
    { id: 'tasks', labelKey: 'nav.tasks', icon: 'i-lucide-check-square', to: '/tasks', capability: 'pmo.tasks.read' },
    { id: 'project-settings', labelKey: 'settings.projects.title', icon: 'i-lucide-settings', to: '/projects/settings', capability: 'pmo.settings.manage' },
  ],
  landing: [
    { path: '/projects/dashboard', capability: 'pmo.projects.read' },
    { path: '/tasks', capability: 'pmo.tasks.read' },
    { path: '/projects', capability: 'pmo.projects.read' },
    { path: '/projects/settings', capability: 'pmo.settings.manage', late: true },
  ],
  routeCapabilities: [
    { pattern: /^\/projects\/settings(?:\/|$)/, capability: 'pmo.settings.manage' },
    { pattern: /^\/tasks\/new$/, capability: 'pmo.tasks.create' },
    { pattern: /^\/projects\/[^/]+\/tasks\/new$/, capability: 'pmo.tasks.create' },
    { pattern: /^\/projects\/new$/, capability: 'pmo.projects.create' },
  ],
  bell: {
    capabilities: ['pmo.tasks.read', 'pmo.projects.read'],
    kinds: [
      ...TaskNotificationKindSchema.options.map(kind => ({ kind, href: (row: Record<string, unknown>) => `/tasks/${row.task_id}`, title: (row: Record<string, unknown>) => String(row.task_name) })),
      ...ProjectNotificationKindSchema.options.map(kind => ({ kind, href: (row: Record<string, unknown>) => `/projects/${row.project_id}/charter`, title: (row: Record<string, unknown>) => String(row.project_name) })),
      {
        kind: 'overdue_digest',
        href: row => `/notification-digests/${row.digest_id}`,
        title: (row, t) => t('tasks.digest.count', Number(row.overdue_count)),
      },
    ],
  },
  search: [projectsSearch, tasksSearch],
  commands: [
    { id: 'pmo.new-project', labelKey: 'nav.newProject', icon: 'i-lucide-folder-kanban', to: '/projects/new', capability: 'pmo.projects.create' },
    { id: 'pmo.new-task', labelKey: 'tasks.new', icon: 'i-lucide-check-square', to: '/tasks/new', capability: 'pmo.tasks.create' },
  ],
  isNavActive(path, target) {
    if (target !== '/projects') return undefined
    if (path === '/projects/dashboard' || path.startsWith('/projects/dashboard/')) return false
    if (isProjectSettings(path)) return false
    return undefined
  },
}
export default manifest
