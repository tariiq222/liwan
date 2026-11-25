import { queryDay, queryPositiveInt } from '../../../utils/routeQuery'

export const BANK_PAGE_SIZE = 25

/** What the filter bar can say: only the filters `GET /finance/bank-statements` supports. */
export interface BankListFilters {
  journalId: number | null
  dateFrom: string | null
  dateTo: string | null
  page: number
}

export interface BankListParams {
  journal_id?: number
  date_from?: string
  date_to?: string
  limit: number
  offset: number
}

type Query = Record<string, unknown>

/** The list filters out of a route query; anything the API would refuse is dropped. */
export function bankFiltersFromQuery(query: Query): BankListFilters {
  const dateFrom = queryDay(query.date_from)
  const dateTo = queryDay(query.date_to)
  const ordered = !dateFrom || !dateTo || dateFrom <= dateTo
  return {
    journalId: queryPositiveInt(query.journal_id),
    dateFrom,
    dateTo: ordered ? dateTo : null,
    page: queryPositiveInt(query.page) ?? 1,
  }
}

export function bankActiveFilterCount(filters: BankListFilters): number {
  return Number(!!filters.journalId) + Number(!!filters.dateFrom) + Number(!!filters.dateTo)
}

export function bankListParams(filters: BankListFilters): BankListParams {
  return {
    ...(filters.journalId ? { journal_id: filters.journalId } : {}),
    ...(filters.dateFrom ? { date_from: filters.dateFrom } : {}),
    ...(filters.dateTo ? { date_to: filters.dateTo } : {}),
    limit: BANK_PAGE_SIZE,
    offset: (filters.page - 1) * BANK_PAGE_SIZE,
  }
}

