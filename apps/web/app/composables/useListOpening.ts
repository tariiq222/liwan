/**
 * True while a link out of a filtered list (a record, the create form) is being opened. The list's debounced filter
 * write must not rewrite the list's URL then: it would cancel the navigation under way. The task list and the project
 * header's create button both set it, so a click right after typing a search is never lost.
 */
export function useListOpening() {
  return useState<boolean>('liwan-list-opening', () => false)
}
