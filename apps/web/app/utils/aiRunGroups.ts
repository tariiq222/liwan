import type { AiRunSummary } from '@webvue/contracts'

export type AiRunGroupKey = 'today' | 'week' | 'older'
export interface AiRunGroup { key: AiRunGroupKey; runs: AiRunSummary[] }

const WEEK_DAYS = 7

/** Groups runs by the local calendar day of their last update: today, the 7 days before it, then older. Keeps the given order, drops empty groups. */
export function groupRunsByDate(runs: readonly AiRunSummary[], now: Date = new Date()): AiRunGroup[] {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfWeek = new Date(startOfToday)
  startOfWeek.setDate(startOfWeek.getDate() - WEEK_DAYS)
  const groups: AiRunGroup[] = [{ key: 'today', runs: [] }, { key: 'week', runs: [] }, { key: 'older', runs: [] }]
  for (const run of runs) {
    const updated = new Date(run.updated_at)
    groups[updated >= startOfToday ? 0 : updated >= startOfWeek ? 1 : 2]!.runs.push(run)
  }
  return groups.filter(group => group.runs.length > 0)
}

/** The runs whose displayed title contains the query (case-insensitive); an empty query keeps every run. */
export function filterRunsByTitle(runs: readonly AiRunSummary[], query: string, titleOf: (run: AiRunSummary) => string): AiRunSummary[] {
  const needle = query.trim().toLocaleLowerCase()
  return needle ? runs.filter(run => titleOf(run).toLocaleLowerCase().includes(needle)) : [...runs]
}
