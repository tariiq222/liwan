import type { LocationQuery, LocationQueryRaw } from 'vue-router'
import type { PersonalTaskState } from '@nasq/contracts'
import type { MyTaskListParams } from '@/composables/useMyTasks'
import { firstQuery } from './routeQuery'

export const MY_TASK_TABS = ['open', 'done'] as const
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
}

const DEFAULTS: MyTaskListState = { tab: 'open', scope: 'all', sort: 'deadline', q: '' }

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
  }
}

/** The data-layer params for a list state ("all" scope and the default sort send nothing). */
export function toListParams(state: MyTaskListState): MyTaskListParams {
  return {
    closed: state.tab === 'done',
    scope: state.scope === 'all' ? undefined : state.scope,
    sort: state.sort === DEFAULTS.sort ? undefined : state.sort,
    q: state.q.trim() || undefined,
  }
}

/** The next URL query: keeps unrelated keys and omits every value equal to its default. */
export function listPatch(query: LocationQueryRaw, patch: Partial<MyTaskListState>): LocationQueryRaw {
  const next: LocationQueryRaw = { ...query }
  for (const key of ['tab', 'scope', 'sort', 'q'] as const) {
    if (!(key in patch)) continue
    const value = patch[key]
    if (value === undefined || value === DEFAULTS[key]) delete next[key]
    else next[key] = value
  }
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

export function localToday(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/**
 * Offset of the next page, or `undefined` at the end. A page may hold fewer rows than `limit` while
 * `total` still counts rows the server dropped, so a short page is not the end: only reaching `total`
 * or receiving an empty page is.
 */
export function nextOffset({ offset, limit, total, received }: { offset: number; limit: number; total: number; received: number }): number | undefined {
  if (received === 0) return undefined
  const next = offset + limit
  return next < total ? next : undefined
}
