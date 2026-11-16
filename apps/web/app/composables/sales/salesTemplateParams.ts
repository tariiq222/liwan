import { listPageNumber, singleQueryValue as single } from '../useRouteListFilters'

export const SALES_TEMPLATES_PATH = '/settings/apps/sales/templates'
/** The query keys of the template list: the way back to it keeps these and drops the rest. */
export const SALES_TEMPLATE_LIST_KEYS = ['q', 'archived', 'page'] as const

export const SALES_TEMPLATE_PAGE_SIZE = 50

export interface SalesTemplateListFilters { q: string; archived: boolean; page: number }

/** The list state of the templates page from its URL query: anything unknown falls back to the default. */
export function parseSalesTemplateQuery(query: Record<string, unknown>): SalesTemplateListFilters {
  return { q: single(query.q).trim(), archived: single(query.archived) === '1', page: listPageNumber(single(query.page)) }
}
