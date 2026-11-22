import { MyTaskSummarySchema } from '@liwan/contracts'
import type { AppCoreCount } from '../types'

/** The badge of «أعمالي» in the core-app row and the phone tab bar: the open count of the personal task summary. */
export const tasksCoreCount: AppCoreCount = {
  id: 'tasks',
  capability: 'tasks.tasks.read',
  to: '/my-tasks',
  queryKey: ['my-tasks', 'summary', 'core-count'],
  count: async api => (await api('/api/v1/my-tasks/summary', { query: { assigned: 'me' }, schema: MyTaskSummarySchema })).open,
}
