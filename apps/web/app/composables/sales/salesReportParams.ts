import { SALES_REPORT_DIMENSIONS, SALES_REPORT_PERIODS, type SalesReportDimension, type SalesReportPeriod, type SalesOrderSource } from '@liwan/contracts'
import { listPageNumber, singleQueryValue as single } from '../useRouteListFilters'

export const SALES_REPORTS_PATH = '/sales/reports'
export const SALES_REPORT_PAGE_SIZE = 25
/** The query keys of the report page: the whole page state lives in the address, so a link, a refresh and Back keep it. */
export const SALES_REPORT_KEYS = ['from', 'to', 'state', 'source', 'by', 'period', 'salesperson', 'customer', 'product', 'page'] as const

/** The state filter of the report: confirmed orders (the default), open quotations, cancelled documents, or every state. */
export const SALES_REPORT_STAGES = ['confirmed', 'quotations', 'cancelled', 'all'] as const
export type SalesReportStage = typeof SALES_REPORT_STAGES[number]
const STAGE_STATES: Record<SalesReportStage, string> = {
  confirmed: 'confirmed',
  quotations: 'draft,sent',
  cancelled: 'cancelled',
  all: 'draft,sent,confirmed,cancelled',
}
export const SALES_REPORT_DEFAULT_BY: SalesReportDimension = 'period'
export const SALES_REPORT_DEFAULT_PERIOD: SalesReportPeriod = 'month'

export interface SalesReportState {
  from: string
  to: string
  stage: SalesReportStage
  source: SalesOrderSource | null
  by: SalesReportDimension
  period: SalesReportPeriod
  /** A salesperson, customer or product picked from a row of the breakdown. */
  salesperson: number | null
  customer: number | null
  product: number | null
  page: number
}

type Query = Record<string, unknown>

const DAY = /^\d{4}-\d{2}-\d{2}$/
const isOneOf = <T extends string>(values: readonly T[], value: string): value is T => (values as readonly string[]).includes(value)
const day = (value: unknown) => { const text = single(value); return DAY.test(text) ? text : '' }
const id = (value: unknown) => { const number = Number(single(value)); return Number.isSafeInteger(number) && number > 0 ? number : null }

/** The report state of `/sales/reports` from its URL query: anything unknown falls back to the default, a reversed range is dropped. */
export function parseSalesReportQuery(query: Query): SalesReportState {
  const stage = single(query.state)
  const source = single(query.source)
  const by = single(query.by)
  const period = single(query.period)
  const from = day(query.from)
  const to = day(query.to)
  const reversed = !!from && !!to && from > to
  return {
    from: reversed ? '' : from,
    to: reversed ? '' : to,
    stage: isOneOf(SALES_REPORT_STAGES, stage) ? stage : 'confirmed',
    source: source === 'staff' || source === 'online' ? source : null,
    by: isOneOf(SALES_REPORT_DIMENSIONS, by) ? by : SALES_REPORT_DEFAULT_BY,
    period: isOneOf(SALES_REPORT_PERIODS, period) ? period : SALES_REPORT_DEFAULT_PERIOD,
    salesperson: id(query.salesperson),
    customer: id(query.customer),
    product: id(query.product),
    page: listPageNumber(single(query.page)),
  }
}

/**
 * The filters every report call takes (the summary, a breakdown and the export), as the server names them. `state` is
 * always sent: the server counts confirmed orders when it is absent, while the summary shows every group.
 */
export function salesReportFilters(state: SalesReportState): Record<string, string> {
  return {
    state: STAGE_STATES[state.stage],
    ...(state.from ? { date_from: state.from } : {}),
    ...(state.to ? { date_to: state.to } : {}),
    ...(state.source ? { source: state.source } : {}),
    ...(state.salesperson ? { salesperson_id: String(state.salesperson) } : {}),
    ...(state.customer ? { customer_id: String(state.customer) } : {}),
    ...(state.product ? { product_id: String(state.product) } : {}),
  }
}

/** The summary shows each state group, so its call carries no state filter of its own. */
export function salesReportSummaryQuery(state: SalesReportState): Record<string, string> {
  const filters = salesReportFilters(state)
  delete filters.state
  return filters
}

/** One page of a breakdown: the dimension, the period size for the `period` dimension, then `limit` and `offset`. */
export function salesReportBreakdownQuery(state: SalesReportState): Record<string, string | number> {
  return {
    ...salesReportFilters(state),
    by: state.by,
    ...(state.by === 'period' ? { period: state.period } : {}),
    limit: SALES_REPORT_PAGE_SIZE,
    offset: (state.page - 1) * SALES_REPORT_PAGE_SIZE,
  }
}

/** How many filters narrow the page beyond its defaults (the badge of the filter bar). */
export function salesReportActiveCount(state: SalesReportState): number {
  return Number(!!state.from) + Number(!!state.to) + Number(state.source !== null) + Number(state.stage !== 'confirmed')
    + Number(state.salesperson !== null) + Number(state.customer !== null) + Number(state.product !== null)
}

/** The query key a breakdown row sets when it is picked, or null for the dimension that cannot narrow (the period). */
export const PICK_KEY: Partial<Record<SalesReportDimension, 'salesperson' | 'customer' | 'product'>> = {
  salesperson: 'salesperson',
  customer: 'customer',
  product: 'product',
}
