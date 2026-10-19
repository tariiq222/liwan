export type DocumentOption = { id: number; name: string }
/** Selected values remain visible even when they lie outside the current search page. */
export function documentLookupItems(selected: number[], known: DocumentOption[], page: DocumentOption[]) {
  const options = new Map([...known, ...page].map(item => [item.id, item]))
  const ids = [...new Set([...selected, ...page.map(item => item.id)])]
  return ids.map(id => ({ value: id, label: options.get(id)?.name ?? `#${id}` }))
}
