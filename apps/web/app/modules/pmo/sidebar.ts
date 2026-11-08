import { ProjectDashboardSummarySchema, TaskSummarySchema } from '@liwan/contracts'
import { PROJECT_ATTENTION_STATUSES } from '../../composables/projectStatus'
import { normalizedPath } from '../../utils/routePath'
import type { AppSearchApi, AppSidebarMenu, AppSidebarRoute } from '../types'

const onPath = (route: AppSidebarRoute, path: string) => normalizedPath(route.path) === path
const insidePath = (route: AppSidebarRoute, path: string) => onPath(route, path) || normalizedPath(route.path).startsWith(`${path}/`)
const needsAttention = (route: AppSidebarRoute) => onPath(route, '/projects') && route.query.status === 'attention'

/**
 * The projects sidebar: one flat level. The status presets of the list are chips on the list page; only «تحتاج انتباه»
 * (at risk and off track together) is also a row, because it is the one answer to "what should I look at".
 */
export const projectsSidebar: AppSidebarMenu = {
  create: 'new-project',
  rows: [
    {
      id: 'project-dashboard', labelKey: 'nav.overview', icon: 'i-lucide-chart-no-axes-combined', to: { path: '/projects/dashboard' },
      capability: 'pmo.projects.read', active: route => insidePath(route, '/projects/dashboard'),
    },
    {
      id: 'projects', labelKey: 'nav.projects', icon: 'i-lucide-folder-kanban', to: { path: '/projects' }, keep: ['view'],
      capability: 'pmo.projects.read',
      // The create panel keeps the list behind it; a project's own pages light its entry under «المفتوحة مؤخرًا».
      active: route => (onPath(route, '/projects') || onPath(route, '/projects/new')) && !needsAttention(route),
    },
    {
      id: 'tasks', labelKey: 'nav.myProjectTasks', icon: 'i-lucide-check-square', to: { path: '/tasks', query: { assignee: 'me' } }, keep: ['view'],
      capability: 'pmo.tasks.read', active: route => insidePath(route, '/tasks'),
    },
    {
      id: 'projects-attention', labelKey: 'nav.needsAttention', icon: 'i-lucide-triangle-alert', to: { path: '/projects', query: { status: 'attention' } }, keep: ['view'],
      capability: 'pmo.projects.read', active: needsAttention,
    },
  ],
  counts: [
    {
      capability: 'pmo.projects.read',
      queryKey: ['projects', 'summary', 'sidebar'],
      async load(api: AppSearchApi) {
        const summary = await api('/api/v1/reports/projects/summary', { schema: ProjectDashboardSummarySchema })
        const attention = summary.status_counts.filter(item => item.status && (PROJECT_ATTENTION_STATUSES as readonly string[]).includes(item.status))
        return { projects: summary.project_count, 'projects-attention': attention.reduce((sum, item) => sum + item.count, 0) }
      },
    },
    {
      capability: 'pmo.tasks.read',
      queryKey: ['tasks', 'summary', 'sidebar', 'mine'],
      // The open tasks assigned to me: what the row's own list shows by default.
      async load(api: AppSearchApi) {
        const summary = await api('/api/v1/tasks/summary', { query: { assignee: 'me' }, schema: TaskSummarySchema })
        return { tasks: summary.open }
      },
    },
  ],
  recent: { kind: 'project', titleKey: 'nav.recentProjects', icon: 'i-lucide-folder', capability: 'pmo.projects.read', to: id => `/projects/${id}` },
}
