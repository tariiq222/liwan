import { listPageNumber } from '../useRouteListFilters'

export const CUSTOMERS_LIST_PATH = '/customers'
export const CUSTOMER_PAGE_SIZE = 25
const LIST_QUERY_KEYS = ['q', 'archived', 'page'] as const

export interface CustomerListState {
  q: string
  archived: boolean
  page: number
}

type Query = Record<string, unknown>

function single(value: unknown): string {
  return typeof value === 'string' ? value : Array.isArray(value) && typeof value[0] === 'string' ? value[0] : ''
}

/** The list state of `/customers` from its URL query: anything unknown (a repeated key, a bad page) falls back to the default. */
export function parseCustomerListQuery(query: Query): CustomerListState {
  return {
    q: single(query.q).trim(),
    archived: single(query.archived) === '1',
    page: listPageNumber(single(query.page)),
  }
}

/** The list address of a route's query with only the list's own keys, kept as the create panel's and a record's way back. */
export function customerListLocation(query: Query, hash = ''): string {
  const search = new URLSearchParams()
  for (const key of LIST_QUERY_KEYS) {
    const value = single(query[key])
    if (value) search.set(key, value)
  }
  return `${CUSTOMERS_LIST_PATH}${search.size ? `?${search}` : ''}${hash}`
}

/** A return address that is the customers list (with or without its query), else the fallback. */
export function safeCustomersReturnTo(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^\/customers(?:[?#]|$)/.test(value) ? value : fallback
}

/** The API query of the list and of its export: the same filters, the export without paging. */
export function customerApiQuery(state: Pick<CustomerListState, 'q' | 'archived'>): Record<string, string> {
  return {
    ...(state.q ? { q: state.q } : {}),
    ...(state.archived ? { archived: 'true' } : {}),
  }
}
