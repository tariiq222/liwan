import type { MyTaskSummary } from '@liwan/contracts'
import type { KpiTile } from '@liwan/ui/app/utils/kpiTile'

type Translate = (key: string, named?: Record<string, unknown>) => string

const percentOf = (count: number, total: number) => total > 0 ? Math.round((count / total) * 100) : undefined

/**
 * The four tiles above the my-tasks list: total, open, overdue and done. Each count carries its share of the
 * total as a caption and bar; the total tile shows the completion share instead. `openTo`, when given, makes
 * the open tile a link back to the list's open tab.
 */
export function myTaskKpiTiles(summary: MyTaskSummary, t: Translate, openTo?: string): KpiTile[] {
  const share = (count: number) => {
    const percent = percentOf(count, summary.total)
    return percent === undefined ? undefined : { progress: percent, hint: t('myTasks.kpi.percentOfTotal', { percent }) }
  }
  const donePercent = percentOf(summary.done, summary.total)
  const completion = donePercent === undefined ? undefined : { progress: donePercent, hint: t('myTasks.kpi.percentDone', { percent: donePercent }) }
  return [
    { id: 'total', label: t('myTasks.kpi.total'), icon: 'i-lucide-list-checks', tone: 'neutral', value: summary.total, ...completion },
    { id: 'open', label: t('myTasks.kpi.open'), icon: 'i-lucide-clock', tone: 'warning', value: summary.open, to: openTo, ...share(summary.open) },
    { id: 'overdue', label: t('myTasks.kpi.overdue'), icon: 'i-lucide-circle-alert', tone: 'danger', value: summary.overdue, ...share(summary.overdue) },
    { id: 'done', label: t('myTasks.kpi.done'), icon: 'i-lucide-circle-check', tone: 'success', value: summary.done, ...share(summary.done) },
  ]
}
