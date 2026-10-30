import type { LocationQuery } from 'vue-router'
import { InboxConversationStateSchema, type InboxConversationState } from '@liwan/contracts'
import { CSAT_SCORES, type CsatScore } from './inboxPresentation'

/** Conversations per list page. */
export const INBOX_PAGE_SIZE = 30

export type InboxAssigneeScope = 'all' | 'me' | 'unassigned'

/** The list filters of the inbox. They live in the URL query, so a direct link, a refresh and Back keep them. */
export interface InboxListRoute {
  assignee: InboxAssigneeScope
  state: InboxConversationState | ''
  departmentId: number | null
  csat: CsatScore | ''
  q: string
  offset: number
}

export const DEFAULT_INBOX_LIST_ROUTE: InboxListRoute = { assignee: 'all', state: '', departmentId: null, csat: '', q: '', offset: 0 }

function single(value: LocationQuery[string] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? ''
}

function positiveInt(value: string): number | null {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : null
}

export function parseInboxListRoute(query: LocationQuery): InboxListRoute {
  const assignee = single(query.assignee)
  const state = InboxConversationStateSchema.safeParse(single(query.state))
  const csat = CSAT_SCORES.find(score => score === single(query.csat))
  const offset = Number(single(query.offset))
  return {
    assignee: assignee === 'me' || assignee === 'unassigned' ? assignee : 'all',
    state: state.success ? state.data : '',
    departmentId: positiveInt(single(query.department_id)),
    csat: csat ?? '',
    q: single(query.q).trim(),
    offset: Number.isSafeInteger(offset) && offset > 0 ? offset : 0,
  }
}

/** Only the filters that differ from the defaults, so the URL of an unfiltered inbox stays clean. */
export function serializeInboxListRoute(route: InboxListRoute): Record<string, string> {
  return {
    ...(route.assignee !== 'all' ? { assignee: route.assignee } : {}),
    ...(route.state ? { state: route.state } : {}),
    ...(route.departmentId ? { department_id: String(route.departmentId) } : {}),
    ...(route.csat ? { csat: route.csat } : {}),
    ...(route.q ? { q: route.q } : {}),
    ...(route.offset ? { offset: String(route.offset) } : {}),
  }
}

/** The query the list endpoint takes (the same filters drive the CSV export). */
export function inboxListQuery(route: InboxListRoute): Record<string, string | number> {
  return {
    ...(route.assignee !== 'all' ? { assignee: route.assignee } : {}),
    ...(route.state ? { state: route.state } : {}),
    ...(route.departmentId ? { department_id: route.departmentId } : {}),
    ...(route.csat ? { csat: route.csat } : {}),
    ...(route.q ? { q: route.q } : {}),
    limit: INBOX_PAGE_SIZE,
    offset: route.offset,
  }
}

/** The offset of a requested page, kept inside the list so a stale link never lands past the end. */
export function inboxPageOffset(page: number, total: number): number {
  const lastPage = Math.max(1, Math.ceil(total / INBOX_PAGE_SIZE))
  return (Math.min(Math.max(page, 1), lastPage) - 1) * INBOX_PAGE_SIZE
}
