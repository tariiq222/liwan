import type { KpiTile } from '@webvue/ui/app/utils/kpiTile'
import type { FinanceInvoice } from '@webvue/contracts'
import type { FinanceMoveType } from './invoiceKinds'
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

/** One KPI count: the list's own filters with the tile's state, and one row asked for because only `total` is read. */
export function invoiceKpiParams(moveType: FinanceMoveType, filters: InvoiceListFilters, state: InvoiceStateFilter | null): InvoiceListParams {
  const { state: _selected, page: _page, ...rest } = filters
  return { ...invoiceListParams(moveType, { ...rest, state, page: 1 }), limit: 1, offset: 0 }
}

export type InvoiceKpiCounts = Record<'total' | InvoiceStateFilter, number | undefined>

/** The strip above a list: the counts the server reports for the list's filters, one tile per state. */
export function invoiceKpiTiles(counts: InvoiceKpiCounts, label: (id: 'total' | InvoiceStateFilter) => string): KpiTile[] {
  const tone = { total: 'neutral', draft: 'warning', posted: 'success', cancel: 'neutral' } as const
  const icon = { total: 'i-lucide-files', draft: 'i-lucide-file-pen', posted: 'i-lucide-file-check', cancel: 'i-lucide-file-x' } as const
  return (['total', ...INVOICE_STATES] as const).map(id => ({
    id,
    label: label(id),
    value: counts[id] ?? null,
    icon: icon[id],
    tone: tone[id],
  }))
}
