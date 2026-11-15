// Query keys of the Support Desk. Every key starts with `['helpdesk']`.
export const helpdeskKeys = {
  all: ['helpdesk'] as const,
  list: (params: object) => ['helpdesk', 'list', params] as const,
  detail: (id: number) => ['helpdesk', 'ticket', id] as const,
  messages: (id: number) => ['helpdesk', 'ticket', id, 'messages'] as const,
  reference: (companyId: number | undefined) => ['helpdesk', 'reference', { companyId }] as const,
  summary: (companyId: number | undefined) => ['helpdesk', 'summary', { companyId }] as const,
  settings: (companyId: number | undefined) => ['helpdesk', 'settings', { companyId }] as const,
}

export type HelpdeskState = 'open' | 'closed' | 'all'
export type HelpdeskAssignee = 'me' | 'none' | null

export interface HelpdeskListState {
  state: HelpdeskState
  q: string
  team: number | null
  stage: number | null
  assignee: HelpdeskAssignee
  priority: string | null
  page: number
}

export const HELPDESK_PAGE_SIZE = 25
export const HELPDESK_LIST_KEYS = ['state', 'q', 'team', 'stage', 'assignee', 'priority', 'page'] as const
export const HELPDESK_LIST_PATH = '/helpdesk'

const STATES: HelpdeskState[] = ['open', 'closed', 'all']
const ASSIGNEES: HelpdeskAssignee[] = ['me', 'none', null]

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function positive(value: unknown): number | null {
  const number = Number(text(value))
  return Number.isInteger(number) && number > 0 ? number : null
}

/** The list state of a URL query: unknown values fall back to the default, so a hand-typed link never breaks a page. */
export function parseHelpdeskListQuery(query: Record<string, unknown>): HelpdeskListState {
  const state = text(query.state) as HelpdeskState
  const assignee = query.assignee === undefined ? null : text(query.assignee) as HelpdeskAssignee
  return {
    state: STATES.includes(state) ? state : 'open',
    q: text(query.q).trim(),
    team: positive(query.team),
    stage: positive(query.stage),
    assignee: ASSIGNEES.includes(assignee) ? assignee : null,
    priority: ['low', 'medium', 'high', 'urgent'].includes(text(query.priority)) ? text(query.priority) : null,
    page: Math.max(1, positive(query.page) ?? 1),
  }
}

/** The query the API reads: only the filters that are set, plus the page. */
export function helpdeskApiQuery(state: HelpdeskListState): Record<string, string | number> {
  const query: Record<string, string | number> = {
    state: state.state,
    limit: HELPDESK_PAGE_SIZE,
    offset: (state.page - 1) * HELPDESK_PAGE_SIZE,
  }
  if (state.q) query.q = state.q
  if (state.team) query.team = state.team
  if (state.stage) query.stage = state.stage
  if (state.assignee) query.assignee = state.assignee
  if (state.priority) query.priority = state.priority
  return query
}
