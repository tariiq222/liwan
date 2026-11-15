import { SalesOrderSourceSchema, type SalesOrderSource, type SalesOrderState } from '@liwan/contracts'
import { listPageNumber, singleQueryValue as single } from '../useRouteListFilters'

export const SALES_LIST_PATH = '/sales'
export const SALES_PAGE_SIZE = 25
/** The query keys of the list itself: the way back to it keeps these and drops the rest. */
export const SALES_LIST_KEYS = ['q', 'state', 'source', 'mine', 'page'] as const

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
