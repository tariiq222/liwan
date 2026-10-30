import type { TaskListParams } from './useTasks'
import { CLOSED_TASK_STATES, OPEN_TASK_STATES, parseStates, taskAttributeFilters, taskAttributeQuery } from './taskFilterParams'
import { normalizeTaskSort } from './taskSort'

// The project screen keeps its task filters in the URL query (not localStorage
// like مهامي) so returning from the task page restores exactly the list that was
// behind it. These two pure functions are the only translation between the
// query and TaskListParams; both the page and the nested task page use them so
// they hit the same vue-query cache key.
export function projectTaskParams(projectId: number, query: Record<string, unknown>): TaskListParams {
  const closed = query.closed === '1'
  // Only known states, and only those the scope can hold: a hand-edited URL never reaches the API.
  const inScope = closed ? CLOSED_TASK_STATES : OPEN_TASK_STATES
  const state = parseStates(query.state)?.filter(value => inScope.includes(value))
  const q = typeof query.q === 'string' && query.q ? query.q : undefined
  return { mine: false, project_id: projectId, closed, state: state?.length ? state : undefined, q, sort: normalizeTaskSort(query.sort), ...taskAttributeFilters(query) }
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
