import type { TaskState } from '@liwan/contracts'
import type { TaskListParams } from './useTasks'
import { taskAttributeFilters, taskAttributeQuery } from './taskFilterParams'
import { normalizeTaskSort } from './taskSort'

// The project screen keeps its task filters in the URL query (not localStorage
// like مهامي) so returning from the task page restores exactly the list that was
// behind it. These two pure functions are the only translation between the
// query and TaskListParams; both the page and the nested task page use them so
// they hit the same vue-query cache key.
export function projectTaskParams(projectId: number, query: Record<string, unknown>): TaskListParams {
  const state = typeof query.state === 'string' && query.state ? (query.state.split(',') as TaskState[]) : undefined
  const q = typeof query.q === 'string' && query.q ? query.q : undefined
  return { mine: false, project_id: projectId, closed: query.closed === '1', state, q, sort: normalizeTaskSort(query.sort), ...taskAttributeFilters(query) }
}

export function projectTaskQuery(params: TaskListParams): Record<string, string | undefined> {
  return {
    closed: params.closed ? '1' : undefined,
    state: params.state?.length ? params.state.join(',') : undefined,
    q: params.q || undefined,
    ...taskAttributeQuery(params),
    sort: params.sort || undefined,
  }
}
