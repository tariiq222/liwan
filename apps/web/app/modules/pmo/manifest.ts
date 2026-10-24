import { ProjectNotificationKindSchema, TaskNotificationKindSchema } from '@webvue/contracts'
import type { AppManifest } from '../types'
import { projectIdFromPath } from './projectRoutes'
import { projectPicker } from './recordPicker'
import { overdueTasksAttention, projectsAtRiskAttention } from './attention'
import { projectsSearch, tasksSearch } from './search'

const manifest: AppManifest = {
  id: 'pmo',
  feature: 'pmo.enabled',
  routePrefixes: ['/projects', '/tasks'],
  rail: [
    { id: 'projects', labelKey: 'nav.projects', icon: 'i-lucide-folder-kanban', to: '/projects', order: 20 },
  ],
  defaultRail: 'projects',
  nav: [
    { to: '/projects/dashboard', labelKey: 'nav.projectDashboard', icon: 'i-lucide-chart-no-axes-combined', shortcut: 'z', capability: 'pmo.projects.read', module: 'projects' },
    { to: '/projects', labelKey: 'nav.projects', icon: 'i-lucide-folder-kanban', shortcut: '2', goKey: 'p', capability: 'pmo.projects.read', module: 'projects' },
    { to: '/tasks', labelKey: 'nav.tasks', icon: 'i-lucide-check-square', shortcut: '1', goKey: 't', capability: 'pmo.tasks.read', module: 'projects' },
  ],
  // Shown for `home` and `projects`, including inside a project (2026-09-11). Project configuration lives under Settings > Apps.
  contextLinks: () => [
    { id: 'new-project', labelKey: 'nav.newProject', icon: 'i-lucide-plus', to: '/projects/new', capability: 'pmo.projects.create', pinned: true },
    { id: 'project-dashboard', labelKey: 'projects.dashboard.title', icon: 'i-lucide-chart-no-axes-combined', to: '/projects/dashboard', capability: 'pmo.projects.read' },
    { id: 'projects', labelKey: 'nav.projects', icon: 'i-lucide-folder-kanban', to: '/projects', capability: 'pmo.projects.read' },
    { id: 'tasks', labelKey: 'nav.myTasks', icon: 'i-lucide-check-square', to: '/tasks', capability: 'pmo.tasks.read' },
  ],
  landing: [
    { path: '/projects/dashboard', capability: 'pmo.projects.read' },
    { path: '/tasks', capability: 'pmo.tasks.read' },
    { path: '/projects', capability: 'pmo.projects.read' },
  ],
  settings: {
    id: 'projects', labelKey: 'nav.projects', icon: 'i-lucide-folder-kanban', to: '/settings/apps/projects',
    parts: [
      { id: 'project-creation', labelKey: 'settings.projects.creation.title', icon: 'i-lucide-circle-plus', capability: 'pmo.settings.manage' },
      { id: 'project-defaults', labelKey: 'settings.projects.defaults.title', icon: 'i-lucide-sliders-horizontal', capability: 'pmo.settings.manage' },
      { id: 'project-reminders', labelKey: 'settings.projects.reminders.label', icon: 'i-lucide-bell-ring', capability: 'pmo.settings.manage' },
      { id: 'catalogs', labelKey: 'settings.projects.catalogs.title', icon: 'i-lucide-list-tree', capability: 'pmo.settings.manage', within: '/settings/apps/projects/catalogs' },
    ],
  },
  recordListSources: [
    { pattern: /^\/projects\/[1-9]\d*\/meetings$/, capability: 'meetings.read' },
  ],
  routeCapabilities: [
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
  attention: [overdueTasksAttention, projectsAtRiskAttention],
  search: [projectsSearch, tasksSearch],
  recordPickers: [projectPicker],
  routeScopes: [{ kind: 'project', idFromPath: projectIdFromPath }],
  commands: [
    { id: 'pmo.new-project', labelKey: 'nav.newProject', icon: 'i-lucide-folder-kanban', to: '/projects/new', capability: 'pmo.projects.create' },
    { id: 'pmo.new-task', labelKey: 'tasks.new', icon: 'i-lucide-check-square', to: '/tasks/new', capability: 'pmo.tasks.create' },
  ],
  isNavActive(path, target) {
    if (target !== '/projects') return undefined
    if (path === '/projects/dashboard' || path.startsWith('/projects/dashboard/')) return false
    return undefined
  },
}
export default manifest
