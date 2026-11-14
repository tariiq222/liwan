import { SalesOrderSourceSchema, type SalesOrderSource, type SalesOrderState } from '@liwan/contracts'
import { listPageNumber } from '../useRouteListFilters'

export const SALES_LIST_PATH = '/sales'
export const SALES_PAGE_SIZE = 25
const LIST_QUERY_KEYS = ['q', 'state', 'source', 'mine', 'page'] as const

/** The state filter of the list: quotations are the draft and sent documents, orders the confirmed ones. */
export const SALES_STAGES = ['all', 'quotations', 'orders', 'cancelled'] as const
export type SalesStage = typeof SALES_STAGES[number]
const STAGE_STATES: Record<Exclude<SalesStage, 'all'>, SalesOrderState[]> = {
  quotations: ['draft', 'sent'],
  orders: ['confirmed'],
  cancelled: ['cancelled'],
}

export interface SalesListState {
  q: string
  stage: SalesStage
  source: SalesOrderSource | null
  mine: boolean
  page: number
}

type Query = Record<string, unknown>

function single(value: unknown): string {
  return typeof value === 'string' ? value : Array.isArray(value) && typeof value[0] === 'string' ? value[0] : ''
}

const isStage = (value: string): value is SalesStage => (SALES_STAGES as readonly string[]).includes(value)

/** The list state of `/sales` from its URL query: anything unknown falls back to the default. */
export function parseSalesListQuery(query: Query): SalesListState {
  const stage = single(query.state)
  const source = SalesOrderSourceSchema.safeParse(single(query.source))
  return {
    q: single(query.q).trim(),
    stage: isStage(stage) ? stage : 'all',
    source: source.success ? source.data : null,
    mine: single(query.mine) === '1',
    page: listPageNumber(single(query.page)),
  }
}

/** The list address of a route's query with only the list's own keys, kept as the create panel's and a record's way back. */
export function salesListLocation(query: Query, hash = ''): string {
  const search = new URLSearchParams()
  for (const key of LIST_QUERY_KEYS) {
    const value = single(query[key])
    if (value) search.set(key, value)
  }
  return `${SALES_LIST_PATH}${search.size ? `?${search}` : ''}${hash}`
}

/** A return address that is the sales list (with or without its query), else the fallback. */
export function safeSalesReturnTo(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^\/sales(?:[?#]|$)/.test(value) ? value : fallback
}

/** The API query of one list page: the filters (a stage as its comma-separated states), then `limit` and `offset`. */
export function salesApiQuery(state: SalesListState): Record<string, string | number> {
  return {
    ...(state.q ? { q: state.q } : {}),
    ...(state.stage !== 'all' ? { state: STAGE_STATES[state.stage].join(',') } : {}),
    ...(state.source ? { source: state.source } : {}),
    ...(state.mine ? { mine: 'true' } : {}),
    limit: SALES_PAGE_SIZE,
    offset: (state.page - 1) * SALES_PAGE_SIZE,
  }
}
