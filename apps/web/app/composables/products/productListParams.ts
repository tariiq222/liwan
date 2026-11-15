import { ProductTypeSchema, type ProductType } from '@liwan/contracts'
import { listPageNumber, singleQueryValue as single } from '../useRouteListFilters'

export const PRODUCTS_LIST_PATH = '/products'
export const PRODUCT_PAGE_SIZE = 25
/** The query keys of the list itself: the way back to it keeps these and drops the rest. */
export const PRODUCT_LIST_KEYS = ['q', 'type', 'archived', 'page'] as const

export interface ProductListState {
  q: string
  type: ProductType | null
  archived: boolean
  page: number
}

type Query = Record<string, unknown>

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
