/** The colour of a KPI tile's icon chip (the danger tone also colours the figure). */
export type KpiTone = 'neutral' | 'warning' | 'danger' | 'success'

/**
 * One tile of a `SharedKpiStrip`. `value` is formatted by the caller (a number is shown as given, `null` shows "—");
 * `hint` is the single muted line under the label, `progress` (0-100) the slim bar under it, `to` makes the tile a link.
 */
export interface KpiTile {
  id: string
  label: string
  value: string | number | null
  icon?: `i-lucide-${string}`
  tone?: KpiTone
  hint?: string
  progress?: number
  to?: string
  /** Optional target navigated to when an active tile is clicked a second time to clear its filter. */
  clearTo?: string
  /** Explicit active state; when omitted, `SharedKpiStrip` matches `to` against the current route. */
  active?: boolean
}

/** Normalizes a route path + query string for KPI tile matching, stripping pagination (`offset`, `page`) and sorting query keys. */
export function normalizeKpiTarget(target: string): { path: string; key: string } {
  const url = new URL(target, 'https://liwan.local')
  const path = url.pathname.replace(/\/+$/, '') || '/'
  const params = [...url.searchParams.entries()]
    .filter(([key, value]) => key !== 'offset' && key !== 'page' && value !== '')
    .sort(([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv))
  const query = new URLSearchParams(params).toString()
  return { path, key: query ? `${path}?${query}` : path }
}

/** Whether `tile` is active for `currentFullPath` (uses explicit `tile.active` when provided, otherwise compares normalized path + query). */
export function isKpiTileActive(tile: Pick<KpiTile, 'active' | 'to'>, currentFullPath: string): boolean {
  if (tile.active !== undefined) return tile.active
  if (!tile.to) return false
  return normalizeKpiTarget(tile.to).key === normalizeKpiTarget(currentFullPath).key
}

/** Link target for a tile: when active, navigates to `clearTo` (or the strip's same-path base tile) to toggle its filter off. */
export function resolveKpiTileTo(tile: Pick<KpiTile, 'to' | 'clearTo'>, active: boolean, tiles: readonly Pick<KpiTile, 'to'>[]): string | undefined {
  if (!tile.to) return undefined
  if (!active) return tile.to
  if (tile.clearTo) return tile.clearTo
  const firstTo = tiles[0]?.to
  if (firstTo && firstTo !== tile.to && normalizeKpiTarget(firstTo).path === normalizeKpiTarget(tile.to).path) return firstTo
  return tile.to
}
