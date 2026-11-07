/** Counts for the list filters, independently of its selected state and page. */
export function financeSummaryPreview(filterRows, url, states) {
  const filters = new URL(url)
  filters.searchParams.delete('state')
  const rows = filterRows(filters)
  return { total: rows.length, ...Object.fromEntries(states.map(state => [state, rows.filter(row => row.state === state).length])) }
}
