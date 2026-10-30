import type { TableSort } from '@liwan/ui/app/utils/dataTable'

// The task list sorts on the server. The URL (`?sort=`) and `TaskListParams.sort` carry the API's own
// `<key> <asc|desc>` value; absent means the default order (record number ascending). Only the sortable columns'
// keys are accepted, so a hand-edited URL cannot send anything else.
export const TASK_SORT_KEYS = { record_number: 'id', deadline: 'date_deadline', priority: 'priority' } as const

const ACCEPTED = new Set<string>(Object.values(TASK_SORT_KEYS))

export function taskSortFromParam(value: unknown): TableSort | null {
  if (typeof value !== 'string') return null
  const [column, direction, ...rest] = value.trim().split(/\s+/)
  if (rest.length || !column || !ACCEPTED.has(column) || (direction !== 'asc' && direction !== 'desc')) return null
  return { column, direction }
}

export function taskSortToParam(sort: TableSort | null): string | undefined {
  return sort ? `${sort.column} ${sort.direction}` : undefined
}

/** The value to keep in `TaskListParams.sort` for a raw query value: valid or undefined. */
export const normalizeTaskSort = (value: unknown) => taskSortToParam(taskSortFromParam(value))
