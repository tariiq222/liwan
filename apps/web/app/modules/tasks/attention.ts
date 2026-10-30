import { MyTaskListPageSchema, type MyTaskListItem } from '@liwan/contracts'
import { localIsoDay } from '@liwan/ui/app/utils/formatDate'
import { ATTENTION_ROWS_PER_PROVIDER } from '../../composables/nav/attentionModel'
import type { AppAttentionProvider, AppAttentionRow } from '../types'

/** Open tasks come back by deadline, so the first page already holds every overdue task and today's. */
const PAGE = 50

type Due = 'overdue' | 'today'

/** The day of the deadline against today, both in the user's own time zone; later deadlines are not attention. */
function dueOf(task: MyTaskListItem, today: string): Due | null {
  if (!task.date_deadline) return null
  const day = localIsoDay(new Date(task.date_deadline))
  if (day < today) return 'overdue'
  return day === today ? 'today' : null
}

/** My open tasks that are overdue or due today, overdue first (the list is already ordered by deadline). */
export const myTasksAttention: AppAttentionProvider = {
  id: 'tasks-due',
  module: 'tasks',
  work: 'execute',
  capability: 'tasks.tasks.read',
  queryKey: ['my-tasks', 'attention', 'due'],
  async load(api, t) {
    const page = await api('/api/v1/my-tasks', { query: { closed: 0, assigned: 'me', sort: 'deadline', limit: PAGE }, schema: MyTaskListPageSchema })
    const today = localIsoDay(new Date())
    const rows: AppAttentionRow[] = []
    for (const task of page.items) {
      const due = dueOf(task, today)
      if (!due) continue
      rows.push({
        id: `task-${task.id}`,
        recordKey: `task:${task.id}`,
        label: task.name,
        to: task.href,
        caption: t(`myTasks.attention.${due}`),
        tone: due === 'overdue' ? 'urgent' : 'normal',
      })
    }
    const first = rows[0]
    if (first?.tone === 'urgent') first.suggestion = t('myTasks.attention.startOverdue')
    return rows.slice(0, ATTENTION_ROWS_PER_PROVIDER)
  },
}
