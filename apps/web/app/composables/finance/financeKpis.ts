import type { KpiTile } from '@liwan/ui/app/utils/kpiTile'

type Translate = (key: string, named?: Record<string, unknown>, plural?: number) => string
type FormatNumber = (value: number, options?: Intl.NumberFormatOptions) => string

/**
 * A figure a tile may show: `undefined` leaves the tile out (the viewer lacks the capability behind it),
 * `null` is a figure still loading or unavailable and shows "—".
 */
type Figure<T = number> = T | null | undefined

export interface FinanceOverviewFigures {
  /** Receivable and payable open balances, in the company currency. */
  receivable: Figure<{ total: number; currency: string }>
  payable: Figure<{ total: number; currency: string }>
  /** Draft documents and customers plus vendors: server totals of limit-1 list requests. */
  drafts: Figure
  partners: Figure
}

function money(figure: { total: number; currency: string } | null, n: FormatNumber): string | null {
  return figure ? n(figure.total, { style: 'currency', currency: figure.currency, currencyDisplay: 'code' }) : null
}

/** The tiles above the finance overview. Every figure is a server total or a report total, never a count of a loaded page. */
export function financeOverviewTiles(figures: FinanceOverviewFigures, t: Translate, n: FormatNumber): KpiTile[] {
  const tiles: Array<KpiTile | null> = [
    figures.receivable === undefined ? null : { id: 'receivable', label: t('finance.kpi.receivable'), icon: 'i-lucide-hand-coins', tone: 'success', value: money(figures.receivable, n), hint: t('finance.kpi.receivableHint') },
    figures.payable === undefined ? null : { id: 'payable', label: t('finance.kpi.payable'), icon: 'i-lucide-banknote-arrow-up', tone: figures.payable?.total ? 'warning' : 'neutral', value: money(figures.payable, n), hint: t('finance.kpi.payableHint') },
    figures.drafts === undefined ? null : { id: 'drafts', label: t('finance.kpi.drafts'), icon: 'i-lucide-file-pen', tone: figures.drafts ? 'warning' : 'neutral', value: figures.drafts, hint: t('finance.kpi.draftsHint') },
    figures.partners === undefined ? null : { id: 'partners', label: t('finance.kpi.partners'), icon: 'i-lucide-contact', tone: 'neutral', value: figures.partners, to: '/finance/partners' },
  ]
  return tiles.filter((tile): tile is KpiTile => tile !== null)
}
