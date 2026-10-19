import type { KpiTile } from '@webvue/ui/app/utils/kpiTile'

/** The tiles above the documents list: server totals of the active and (for archivers) archived documents. */
export function documentKpiTiles(figures: { total: number | null; archived: number | null | undefined }, t: (key: string) => string): KpiTile[] {
  const tiles: Array<KpiTile | null> = [
    { id: 'total', label: t('documents.kpi.total'), icon: 'i-lucide-files', tone: 'neutral', value: figures.total ?? null },
    figures.archived === undefined ? null : { id: 'archived', label: t('documents.kpi.archived'), icon: 'i-lucide-archive', tone: 'neutral', value: figures.archived, to: '/documents?archived=1' },
  ]
  return tiles.filter((tile): tile is KpiTile => tile !== null)
}
