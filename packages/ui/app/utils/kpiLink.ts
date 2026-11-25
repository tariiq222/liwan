export type KpiLinkFilters = Record<string, string | number | boolean | undefined>

/** A link to `path` with the given filters as its query; empty values are left out. */
export function kpiLink(path: string, filters: KpiLinkFilters): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === false || value === '') continue
    query.set(key, value === true ? '1' : String(value))
  }
  const text = query.toString()
  return text ? `${path}?${text}` : path
}
