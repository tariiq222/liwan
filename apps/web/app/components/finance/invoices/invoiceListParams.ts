import type { KpiTile } from '@liwan/ui/app/utils/kpiTile'
import type { FinanceInvoice } from '@liwan/contracts'
import { financeListKpiTiles, financeStateTiles } from '../../../utils/financeKpis'
import { INVOICE_KINDS, type FinanceMoveType } from './invoiceKinds'
import { queryText, queryDay } from '../../../utils/routeQuery'

export const INVOICE_PAGE_SIZE = 25
export const INVOICE_STATES = ['draft', 'posted', 'cancel'] as const satisfies readonly FinanceInvoice['state'][]
export type InvoiceStateFilter = (typeof INVOICE_STATES)[number]

/** What the filter bar can say: only the filters `GET /finance/invoices` supports. */
export interface InvoiceListFilters {
  q: string
  state: InvoiceStateFilter | null
  partnerId: number | null
  dateFrom: string | null
  dateTo: string | null
  page: number
}

export interface InvoiceListParams {
  move_type: FinanceMoveType
  state?: InvoiceStateFilter
  partner_id?: number
  date_from?: string
  date_to?: string
  q?: string
  limit: number
  offset: number
}

type Query = Record<string, unknown>

/** The list filters out of a route query; anything the API would refuse is dropped. */
export function invoiceFiltersFromQuery(query: Query): InvoiceListFilters {
  const state = queryText(query.state)
  const partner = Number(queryText(query.partner_id))
  const page = Number(queryText(query.page))
  const dateFrom = queryDay(query.date_from)
  const dateTo = queryDay(query.date_to)
  const ordered = !dateFrom || !dateTo || dateFrom <= dateTo
  return {
    q: queryText(query.q) ?? '',
    state: INVOICE_STATES.find(value => value === state) ?? null,
    partnerId: Number.isSafeInteger(partner) && partner > 0 ? partner : null,
    dateFrom,
    dateTo: ordered ? dateTo : null,
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
  }
}

/** The number of filters the bar has applied (the search box counts too). */
export function invoiceActiveFilterCount(filters: InvoiceListFilters): number {
  return Number(!!filters.q) + Number(!!filters.state) + Number(!!filters.partnerId) + Number(!!filters.dateFrom) + Number(!!filters.dateTo)
}

export function invoiceListParams(moveType: FinanceMoveType, filters: InvoiceListFilters): InvoiceListParams {
  return {
    move_type: moveType,
    ...(filters.state ? { state: filters.state } : {}),
    ...(filters.partnerId ? { partner_id: filters.partnerId } : {}),
    ...(filters.dateFrom ? { date_from: filters.dateFrom } : {}),
    ...(filters.dateTo ? { date_to: filters.dateTo } : {}),
    ...(filters.q ? { q: filters.q } : {}),
    limit: INVOICE_PAGE_SIZE,
    offset: (filters.page - 1) * INVOICE_PAGE_SIZE,
  }
}

/** The summary has the list filters, without its selected state or page window. */
export function invoiceSummaryParams(moveType: FinanceMoveType, filters: InvoiceListFilters) {
  const { state: _state, limit: _limit, offset: _offset, ...params } = invoiceListParams(moveType, filters)
  return params
}

export type InvoiceKpiCounts = Record<'total' | InvoiceStateFilter, number | undefined>

const INVOICE_KPI_STATES = [
  { id: 'draft', icon: 'i-lucide-file-pen', tone: 'warning' },
  { id: 'posted', icon: 'i-lucide-file-check', tone: 'success' },
  { id: 'cancel', icon: 'i-lucide-file-x', tone: 'neutral' },
] as const

/** The strip above a list: one tile per state, linked to the list's own filters. */
export function invoiceKpiTiles(moveType: FinanceMoveType, filters: InvoiceListFilters, counts: InvoiceKpiCounts, t: (key: string) => string): KpiTile[] {
  return financeListKpiTiles(
    financeStateTiles(INVOICE_KPI_STATES, 'i-lucide-files', id => t(`financeDocuments.kpi.${id}`)),
    counts,
    INVOICE_KINDS[moveType].listPath,
    { q: filters.q, partner_id: filters.partnerId ?? undefined, date_from: filters.dateFrom ?? undefined, date_to: filters.dateTo ?? undefined },
  )
}
