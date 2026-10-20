import type { LocationQuery } from 'vue-router'

/**
 * The link of a report row that opens one account's lines under it (`account_id` in the URL): the row itself when it is closed,
 * and the report without `account_id` when it is the open one. The lines restart at their first page either way.
 */
export function accountToggleTo(route: { path: string; query: LocationQuery }, id: number, selectedId: number | null) {
  const { account_id: _open, page: _page, ...rest } = route.query
  return { path: route.path, query: id === selectedId ? rest : { ...rest, account_id: String(id) } }
}
