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
}
