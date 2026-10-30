import { ProjectListSchema, TaskListSchema } from '@liwan/contracts'
import { ATTENTION_ROWS_PER_PROVIDER } from '../../composables/nav/attentionModel'
import { PROJECT_STATUS_LABEL_KEY } from '../../composables/projectStatus'
import type { AppAttentionProvider } from '../types'

/** My project tasks whose deadline has passed, oldest deadline first. */
export const overdueTasksAttention: AppAttentionProvider = {
  id: 'pmo-tasks-overdue',
  module: 'projects',
  work: 'execute',
  capability: 'pmo.tasks.read',
  queryKey: ['tasks', 'attention', 'overdue'],
  async load(api, t) {
    const page = await api('/api/v1/tasks', { query: { filter: 'mine', deadline: 'overdue', sort: 'date_deadline', limit: ATTENTION_ROWS_PER_PROVIDER }, schema: TaskListSchema })
    const rows = page.items.slice(0, ATTENTION_ROWS_PER_PROVIDER).map(task => ({
      id: `task-${task.id}`,
      recordKey: `task:${task.id}`,
      label: task.name,
      to: `/tasks/${task.id}`,
      caption: task.project?.name,
      tone: 'urgent' as const,
    }))
    const first = rows[0]
    return first ? [{ ...first, suggestion: t('tasks.attention.startOverdue') }, ...rows.slice(1)] : rows
  },
}

/** My other open project tasks, nearest deadline first; the overdue ones already come from the provider above (same recordKey). */
export const openTasksAttention: AppAttentionProvider = {
  id: 'pmo-tasks-open',
  module: 'projects',
  work: 'execute',
  capability: 'pmo.tasks.read',
  queryKey: ['tasks', 'attention', 'open'],
  async load(api) {
    const page = await api('/api/v1/tasks', { query: { filter: 'mine', sort: 'date_deadline', limit: ATTENTION_ROWS_PER_PROVIDER }, schema: TaskListSchema })
    return page.items.slice(0, ATTENTION_ROWS_PER_PROVIDER).map(task => ({
      id: `task-${task.id}`,
      recordKey: `task:${task.id}`,
      label: task.name,
      to: `/tasks/${task.id}`,
      caption: task.project?.name,
      tone: 'normal' as const,
    }))
  },
}

/** Statuses that need a look, worst first; a project the user cannot read never comes back from the list. */
const RISK_STATUSES = ['off_track', 'at_risk'] as const

/** Projects off track, then at risk, among those I can read. */
export const projectsAtRiskAttention: AppAttentionProvider = {
  id: 'pmo-projects-at-risk',
  module: 'projects',
  work: 'follow',
  capability: 'pmo.projects.read',
  queryKey: ['projects', 'attention', 'at-risk'],
  async load(api, t) {
    const pages = await Promise.all(RISK_STATUSES.map(status => api('/api/v1/projects', { query: { status, limit: ATTENTION_ROWS_PER_PROVIDER }, schema: ProjectListSchema })))
    return pages
      .flatMap(page => page.items)
      .slice(0, ATTENTION_ROWS_PER_PROVIDER)
      .map(project => ({
        id: `project-${project.id}`,
        label: project.name,
        to: `/projects/${project.id}`,
        caption: project.status ? t(PROJECT_STATUS_LABEL_KEY[project.status]) : undefined,
        tone: 'normal' as const,
      }))
  },
}
