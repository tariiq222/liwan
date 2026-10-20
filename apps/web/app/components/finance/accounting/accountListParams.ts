import { FinanceAccountTypeSchema, type FinanceAccount } from '@webvue/contracts'
import { queryPositiveInt, queryText } from '../../../utils/routeQuery'

export const ACCOUNT_PAGE_SIZE = 25
export const ACCOUNT_TYPES = FinanceAccountTypeSchema.options
export type AccountTypeFilter = FinanceAccount['account_type']

/** What the filter bar can say: only the filters `GET /finance/accounts` supports. */
export interface AccountListFilters {
  q: string
  accountType: AccountTypeFilter | null
  page: number
}

export interface AccountListParams {
  account_type?: AccountTypeFilter
  q?: string
  limit: number
  offset: number
}

/** The list filters out of a route query; anything the API would refuse is dropped. */
export function accountFiltersFromQuery(query: Record<string, unknown>): AccountListFilters {
  const accountType = queryText(query.account_type)
  return {
    q: queryText(query.q) ?? '',
    accountType: ACCOUNT_TYPES.find(value => value === accountType) ?? null,
    page: queryPositiveInt(query.page) ?? 1,
  }
}

/** The number of filters the bar has applied (the search box counts too). */
export function accountActiveFilterCount(filters: AccountListFilters): number {
  return Number(!!filters.q) + Number(!!filters.accountType)
}

export function accountListParams(filters: AccountListFilters): AccountListParams {
  return {
    ...(filters.accountType ? { account_type: filters.accountType } : {}),
    ...(filters.q ? { q: filters.q } : {}),
    limit: ACCOUNT_PAGE_SIZE,
    offset: (filters.page - 1) * ACCOUNT_PAGE_SIZE,
  }
}
