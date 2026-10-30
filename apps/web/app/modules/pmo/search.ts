import { ProjectRefSchema, TaskListSchema } from '@liwan/contracts'
import type { AppSearchProvider } from '../types'

const PROJECTS_CAP = 200
const TASKS_PAGE = 20

/** Projects: one unfiltered fetch (minimal), filtered by name on the client. */
export const projectsSearch: AppSearchProvider = {
  id: 'pmo-projects',
  labelKey: 'nav.projects',
  capability: 'pmo.projects.read',
  icon: 'i-lucide-folder',
  serverSearch: false,
  queryKey: () => ['search', 'projects'],
  truncatedKey: 'projects.capped',
  async search(api) {
    const projects = await api('/api/v1/projects', { query: { minimal: 1 }, schema: ProjectRefSchema.array() })
    return {
      rows: projects.map(project => ({ id: project.id, label: project.name, to: `/projects/${project.id}` })),
      truncated: projects.length >= PROJECTS_CAP,
    }
  },
}

/** Tasks assigned to me that match `q`, twenty at a time. */
export const tasksSearch: AppSearchProvider = {
  id: 'pmo-tasks',
  labelKey: 'nav.tasks',
  capability: 'pmo.tasks.read',
  icon: 'i-lucide-check-square',
  serverSearch: true,
  queryKey: q => ['search', 'tasks', q],
  async search(api, q, offset) {
    const page = await api('/api/v1/tasks', { query: { filter: 'mine', q, limit: TASKS_PAGE, offset }, schema: TaskListSchema })
    return {
      rows: page.items.map(task => ({ id: task.id, label: task.name, to: `/tasks/${task.id}` })),
      total: page.total,
    }
  },
}
