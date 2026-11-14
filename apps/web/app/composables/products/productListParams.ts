import { ProductTypeSchema, type ProductType } from '@liwan/contracts'
import { listPageNumber } from '../useRouteListFilters'

export const PRODUCTS_LIST_PATH = '/products'
export const PRODUCT_PAGE_SIZE = 25
const LIST_QUERY_KEYS = ['q', 'type', 'archived', 'page'] as const

export interface ProductListState {
  q: string
  type: ProductType | null
  archived: boolean
  page: number
}

type Query = Record<string, unknown>

function single(value: unknown): string {
  return typeof value === 'string' ? value : Array.isArray(value) && typeof value[0] === 'string' ? value[0] : ''
}

/** The list state of `/products` from its URL query: anything unknown (a repeated key, a bad type or page) falls back to the default. */
export function parseProductListQuery(query: Query): ProductListState {
  const type = ProductTypeSchema.safeParse(single(query.type))
  return {
    q: single(query.q).trim(),
    type: type.success ? type.data : null,
    archived: single(query.archived) === '1',
    page: listPageNumber(single(query.page)),
  }
}

/** The list address of a route's query with only the list's own keys, kept as the create panel's and a record's way back. */
export function productListLocation(query: Query, hash = ''): string {
  const search = new URLSearchParams()
  for (const key of LIST_QUERY_KEYS) {
    const value = single(query[key])
    if (value) search.set(key, value)
  }
  return `${PRODUCTS_LIST_PATH}${search.size ? `?${search}` : ''}${hash}`
}

/** A return address that is the products list (with or without its query), else the fallback. */
export function safeProductsReturnTo(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^\/products(?:[?#]|$)/.test(value) ? value : fallback
}

/** The API query of one list page: the filters, then the page as `limit` and `offset`. */
export function productApiQuery(state: ProductListState): Record<string, string | number> {
  return {
    ...(state.q ? { q: state.q } : {}),
    ...(state.type ? { type: state.type } : {}),
    ...(state.archived ? { archived: 'true' } : {}),
    limit: PRODUCT_PAGE_SIZE,
    offset: (state.page - 1) * PRODUCT_PAGE_SIZE,
  }
}
