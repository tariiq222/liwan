import type { TaskListParams } from '@/composables/useTasks'

/**
 * Whether the KPI tiles show their share caption and progress bar. They do not when the active filters decide the
 * shares by construction: `deadline=overdue` (every counted task is open and overdue) or any state selection.
 */
export function kpiSharesApply(params: Pick<TaskListParams, 'deadline' | 'state'>): boolean {
  return params.deadline !== 'overdue' && !params.state?.length
}
