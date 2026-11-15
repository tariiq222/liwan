import { listPageNumber, singleQueryValue as single } from '../useRouteListFilters'

export const CUSTOMERS_LIST_PATH = '/customers'
export const CUSTOMER_PAGE_SIZE = 25
/** The query keys of the list itself: the way back to it keeps these and drops the rest. */
export const CUSTOMER_LIST_KEYS = ['q', 'archived', 'page'] as const

export interface CustomerListState {
  q: string
  archived: boolean
  page: number
}

type Query = Record<string, unknown>

/** The list state of `/customers` from its URL query: anything unknown (a repeated key, a bad page) falls back to the default. */
export function parseCustomerListQuery(query: Query): CustomerListState {
  return {
    q: single(query.q).trim(),
    archived: single(query.archived) === '1',
    page: listPageNumber(single(query.page)),
  }
}

/** The API query of the list and of its export: the same filters, the export without paging. */
export function customerApiQuery(state: Pick<CustomerListState, 'q' | 'archived'>): Record<string, string> {
  return {
    ...(state.q ? { q: state.q } : {}),
    ...(state.archived ? { archived: 'true' } : {}),
  }
}
