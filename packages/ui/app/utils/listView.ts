import type { ComputedRef, InjectionKey } from 'vue'
import type { LocationQuery, LocationQueryRaw } from 'vue-router'

/** One choice of SharedViewSwitch: the `?view=` value, its translated label, its icon and an optional test id. */
export interface ListViewOption { value: string; label: string; icon: string; testId?: string }

/** The view the route asks for; the first option when the query names none or one this list does not offer. */
export function currentListView(query: unknown, options: readonly Pick<ListViewOption, 'value'>[]): string {
  const asked = Array.isArray(query) ? query[0] : query
  return options.find(option => option.value === asked)?.value ?? options[0]?.value ?? ''
}

/** The query after choosing a view. The first option is the default, so its URL has no `view` key (`/tasks` vs `/tasks?view=board`). */
export function listViewQuery(query: LocationQuery, value: string, options: readonly Pick<ListViewOption, 'value'>[]): LocationQueryRaw {
  return { ...query, view: value === options[0]?.value ? undefined : value }
}

/** What a list page offers its embedded filter bar when `viewsInFilters` is set: the bar draws the view switch in its own row. */
export interface ListViewContext { view: ComputedRef<string | undefined>; options: readonly ListViewOption[]; setView: (value: string) => void }
export const LIST_VIEW_KEY: InjectionKey<ListViewContext> = Symbol('webvue-list-view')
