import type { KpiTile } from '@liwan/ui/app/utils/kpiTile'
import { DOCUMENT_EXPIRING_DAYS } from '../lib/documentKeys'

type Figure = number | null

/** The tiles above the documents list: server totals of the active (and for archivers archived) documents, the restricted ones and those expiring or expired. */
export function documentKpiTiles(figures: { total: Figure; archived: Figure | undefined; restricted: Figure; expiring: Figure; expired: Figure }, t: (key: string, params?: Record<string, unknown>) => string): KpiTile[] {
  const tiles: Array<KpiTile | null> = [
    { id: 'total', label: t('documents.kpi.total'), icon: 'i-lucide-files', tone: 'neutral', value: figures.total },
    { id: 'restricted', label: t('documents.kpi.restricted'), icon: 'i-lucide-lock', tone: 'neutral', value: figures.restricted, to: '/documents?visibility=restricted' },
    { id: 'expiring', label: t('documents.kpi.expiring', { days: DOCUMENT_EXPIRING_DAYS }), icon: 'i-lucide-hourglass', tone: figures.expiring ? 'warning' : 'neutral', value: figures.expiring, to: `/documents?expiring_within=${DOCUMENT_EXPIRING_DAYS}` },
    { id: 'expired', label: t('documents.kpi.expired'), icon: 'i-lucide-calendar-x', tone: figures.expired ? 'danger' : 'neutral', value: figures.expired, to: '/documents?expired=1' },
    figures.archived === undefined ? null : { id: 'archived', label: t('documents.kpi.archived'), icon: 'i-lucide-archive', tone: 'neutral', value: figures.archived, to: '/documents?archived=1' },
  ]
  return tiles.filter((tile): tile is KpiTile => tile !== null)
}
