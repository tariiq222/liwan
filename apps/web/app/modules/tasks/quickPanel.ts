import { MyTaskSummarySchema } from '@liwan/contracts'
import type { AppQuickPanel } from '../types'

/** My open tasks in the top bar; the badge is the open count of the personal task summary. */
export const tasksQuickPanel: AppQuickPanel = {
  id: 'tasks',
  labelKey: 'nav.myTasks',
  icon: 'i-lucide-check-square',
  capability: 'tasks.tasks.read',
  to: '/my-tasks',
  queryKey: ['my-tasks', 'summary', 'quick-panel'],
  count: async api => (await api('/api/v1/my-tasks/summary', { query: { assigned: 'me' }, schema: MyTaskSummarySchema })).open,
  load: () => import('../../components/personal-tasks/TasksQuickPanel.vue'),
}
