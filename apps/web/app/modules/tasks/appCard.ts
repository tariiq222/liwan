import { MyTaskSummarySchema } from '@liwan/contracts'
import type { AppCard, AppSearchApi } from '../types'

const CAPABILITY = 'tasks.tasks.read'
const summary = (api: AppSearchApi) => api('/api/v1/my-tasks/summary', { query: { assigned: 'me' }, schema: MyTaskSummarySchema })

/** My open and overdue tasks, from the counts the personal task list already shows. */
export const tasksAppCard: AppCard = {
  category: 'team',
  plan: 'included',
  surface: 'lav',
  figures: [
    { labelKey: 'launcher.figures.tasks.open', capability: CAPABILITY, queryKey: ['my-tasks', 'summary', 'app-card', 'open'], load: async api => (await summary(api)).open },
    { labelKey: 'launcher.figures.tasks.overdue', capability: CAPABILITY, queryKey: ['my-tasks', 'summary', 'app-card', 'overdue'], load: async api => (await summary(api)).overdue },
  ],
}
