import type { Task, TaskState } from '@webvue/contracts'
import type { TaskListParams } from './useTasks'

// The three attribute filters of the task list. The URL (`?assignee=`, `?deadline=`, `?priority=`) and the API
// query carry the same text; `TaskListParams` holds the typed value. Anything outside the accepted values is dropped,
// so a hand-edited URL or stale stored state can never reach the API.
export const TASK_PRIORITIES = ['3', '2', '1', '0'] as const satisfies readonly Task['priority'][]
export const TASK_DEADLINES = ['overdue', 'today', 'week', 'none'] as const
export type TaskAssignee = 'me' | 'none' | number
export type TaskDeadline = (typeof TASK_DEADLINES)[number]
export type TaskPriority = (typeof TASK_PRIORITIES)[number]
export type TaskAttributeFilters = Pick<TaskListParams, 'assignee' | 'deadline' | 'priority'>

const FILTER_KEYS = ['assignee', 'deadline', 'priority'] as const

// The open scope only holds unfinished tasks and the closed scope only done/cancelled ones (the API filters on is_closed).
export const OPEN_TASK_STATES: TaskState[] = ['in_progress', 'waiting', 'changes_requested', 'approved']
export const CLOSED_TASK_STATES: TaskState[] = ['done', 'cancelled']

export function parseAssignee(value: unknown): TaskAssignee | undefined {
  if (value === 'me' || value === 'none') return value
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value
  return typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : undefined
}

export function parseDeadline(value: unknown): TaskDeadline | undefined {
  return TASK_DEADLINES.find(deadline => deadline === value)
}

/** The distinct valid priorities of a comma list (or an array), most urgent first; undefined when none is valid. */
export function parsePriorities(value: unknown): TaskPriority[] | undefined {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []
  const picked = TASK_PRIORITIES.filter(priority => raw.some(item => String(item).trim() === priority))
  return picked.length ? picked : undefined
}

/** The attribute filters set in a raw object (URL query or stored state): only the keys holding a valid value. */
export function taskAttributeFilters(raw: Record<string, unknown>): TaskAttributeFilters {
  const filters: TaskAttributeFilters = {}
  const assignee = parseAssignee(raw.assignee)
  const deadline = parseDeadline(raw.deadline)
  const priority = parsePriorities(raw.priority)
  if (assignee !== undefined) filters.assignee = assignee
  if (deadline) filters.deadline = deadline
  if (priority) filters.priority = priority
  return filters
}

/** The search text of a URL query (`?q=`); undefined when absent or blank. */
export function taskSearchText(query: Record<string, unknown>): string | undefined {
  return typeof query.q === 'string' && query.q.trim() ? query.q.trim() : undefined
}

/** Stored filters with the attribute filters re-validated, then the URL's own on top: the URL wins, an absent key falls back. The search text (`?q=`) follows the same rule. */
export function withTaskAttributeFilters<T extends TaskAttributeFilters>(stored: T, query: Record<string, unknown>): T {
  const { assignee: _a, deadline: _d, priority: _p, ...rest } = stored
  const q = taskSearchText(query)
  return { ...rest, ...taskAttributeFilters(stored), ...taskAttributeFilters(query), ...(q ? { q } : {}) } as T
}

type TaskListFilters = TaskAttributeFilters & Pick<TaskListParams, 'closed' | 'state' | 'project_id' | 'q'>

function parseProjectId(value: unknown): number | undefined {
  return typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : undefined
}

function parseStates(value: unknown): TaskState[] | undefined {
  if (typeof value !== 'string') return undefined
  const known = [...OPEN_TASK_STATES, ...CLOSED_TASK_STATES]
  const picked = known.filter(state => value.split(',').includes(state))
  return picked.length ? picked : undefined
}

/**
 * The whole filter state of the task list. The URL wins and an absent key falls back to the stored value, except the
 * scope: `closed` lives in the URL alone, so the "all tasks" link (no key) always opens the open scope. A state the
 * scope cannot contain is dropped, so a preset link never silently empties the list.
 */
export function withTaskListFilters<T extends TaskListFilters>(stored: T, query: Record<string, unknown>): T {
  const closed = query.closed === '1'
  const merged = withTaskAttributeFilters(stored, query)
  const inScope = closed ? CLOSED_TASK_STATES : OPEN_TASK_STATES
  const state = (parseStates(query.state) ?? merged.state)?.filter(value => inScope.includes(value))
  return { ...merged, closed, state: state?.length ? state : undefined, project_id: parseProjectId(query.project_id) ?? merged.project_id }
}

/** The filter state as URL query values (undefined removes the key). */
export function taskListQuery(params: TaskListFilters) {
  return {
    ...taskAttributeQuery(params),
    closed: params.closed ? '1' : undefined,
    state: params.state?.length ? params.state.join(',') : undefined,
    project_id: params.project_id ? String(params.project_id) : undefined,
    q: params.q?.trim() || undefined,
  }
}

/** The attribute filters as URL query values (undefined removes the key). */
export function taskAttributeQuery(params: TaskAttributeFilters): Record<(typeof FILTER_KEYS)[number], string | undefined> {
  return {
    assignee: params.assignee === undefined ? undefined : String(params.assignee),
    deadline: params.deadline,
    priority: params.priority?.length ? params.priority.join(',') : undefined,
  }
}

/** How many of the three attribute filters are set. */
export const taskAttributeFilterCount = (params: TaskAttributeFilters) => Number(params.assignee !== undefined) + Number(Boolean(params.deadline)) + Number(Boolean(params.priority?.length))
