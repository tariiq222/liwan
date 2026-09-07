export function hasPendingHrSearch(search: string, committedSearch: unknown) {
  return search.trim() !== String(committedSearch ?? '').trim()
}

export function hrCommittedListParams(routeQuery: { q?: unknown; offset?: unknown }) {
  const rawOffset = Number(routeQuery.offset ?? 0)
  return {
    q: String(routeQuery.q ?? '').trim() || undefined,
    offset: Number.isFinite(rawOffset) ? Math.max(0, rawOffset) : 0,
  }
}
