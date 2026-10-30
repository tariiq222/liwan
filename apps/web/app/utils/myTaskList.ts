import type { LocationQuery, LocationQueryRaw } from 'vue-router'
import type { PersonalTaskState } from '@liwan/contracts'
import type { MyTaskListParams } from '@/composables/useMyTasks'
import { firstQuery } from './routeQuery'

export const MY_TASK_TABS = ['open', 'closed', 'archived'] as const
export const MY_TASK_SCOPES = ['all', 'assigned', 'created'] as const
export const MY_TASK_SORTS = ['deadline', 'created', 'name'] as const
export const MY_TASK_PAGE_SIZE = 50

export type MyTaskTab = typeof MY_TASK_TABS[number]
export type MyTaskScope = typeof MY_TASK_SCOPES[number]
export type MyTaskSort = typeof MY_TASK_SORTS[number]

export interface MyTaskListState {
  tab: MyTaskTab
  scope: MyTaskScope
  sort: MyTaskSort
  q: string
  offset: number
}

const DEFAULTS: MyTaskListState = { tab: 'open', scope: 'all', sort: 'deadline', q: '', offset: 0 }

function oneOf<T extends string>(values: readonly T[], value: unknown, fallback: T): T {
  const raw = firstQuery(value)
  return values.find(item => item === raw) ?? fallback
}

/** The list state held in the URL; anything unknown falls back to its default. */
export function parseListState(query: LocationQuery | LocationQueryRaw): MyTaskListState {
  return {
    tab: oneOf(MY_TASK_TABS, query.tab, DEFAULTS.tab),
    scope: oneOf(MY_TASK_SCOPES, query.scope, DEFAULTS.scope),
    sort: oneOf(MY_TASK_SORTS, query.sort, DEFAULTS.sort),
    q: firstQuery(query.q) ?? '',
    offset: Number.isInteger(Number(firstQuery(query.offset))) && Number(firstQuery(query.offset)) > 0 ? Math.floor(Number(firstQuery(query.offset)) / MY_TASK_PAGE_SIZE) * MY_TASK_PAGE_SIZE : 0,
  }
}

/** The data-layer params for a list state ("all" scope and the default sort send nothing). */
export function toListParams(state: MyTaskListState): MyTaskListParams {
  return {
    closed: state.tab === 'closed',
    archived: state.tab === 'archived' ? true : undefined,
    scope: state.scope === 'all' ? undefined : state.scope,
    sort: state.sort === DEFAULTS.sort ? undefined : state.sort,
    q: state.q.trim() || undefined,
    offset: state.offset,
  }
}

/** The offset of the last page that still has rows (0 for an empty list): where a past-the-end offset lands. */
export function lastPageOffset(total: number): number {
  return Math.max(0, Math.ceil(total / MY_TASK_PAGE_SIZE) - 1) * MY_TASK_PAGE_SIZE
}

/** The next URL query: keeps unrelated keys and omits every value equal to its default. */
export function listPatch(query: LocationQueryRaw, patch: Partial<MyTaskListState>): LocationQueryRaw {
  const next: LocationQueryRaw = { ...query }
  for (const key of ['tab', 'scope', 'sort', 'q', 'offset'] as const) {
    if (!(key in patch)) continue
    const value = patch[key]
    if (value === undefined || value === DEFAULTS[key]) delete next[key]
    else next[key] = value
  }
  const previous = parseListState(query)
  if ((['tab', 'scope', 'sort', 'q'] as const).some(key => key in patch && patch[key] !== previous[key])) delete next.offset
  return next
}

/** The wire deadline is `...T00:00:00Z` for a date: its UTC date part is the day, with no zone shift. */
export function deadlineDay(deadline: string | null): string | null {
  return deadline ? deadline.slice(0, 10) : null
}

/** `today` is a local `YYYY-MM-DD`; ISO dates compare as strings. */
export function isOverdue(deadline: string | null, state: PersonalTaskState, today: string): boolean {
  const day = deadlineDay(deadline)
  return state === 'open' && day !== null && day < today
}

