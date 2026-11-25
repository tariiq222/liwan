import type { FinanceAgedPartnerBalance } from '@liwan/contracts'
import { kpiLink } from '@liwan/ui/app/utils/kpiLink'
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

/**
 * What customers owe (`receivable`) or what the company owes vendors (`payable`), from the aged balance report: only
 * the rows of a named partner count, so payroll and tax liabilities booked on a payable account without a partner stay
 * out. Payable balances are credits (negative in the report) and are shown as a positive amount owed.
 */
export function agedOwed(report: Pick<FinanceAgedPartnerBalance, 'kind' | 'currency' | 'accounts'>): { total: number; currency: string } {
  const open = report.accounts.flatMap(account => account.partners).filter(row => row.partner !== null).reduce((sum, row) => sum + row.total, 0)
  const total = (report.kind === 'payable' ? -open : open) + 0
  return { total: Math.round(total * 100) / 100, currency: report.currency }
}

/** One tile a finance list can show: the query it adds over the list's own filters, absent on its total tile. */
export interface FinanceListTile {
  id: string
  label: string
  icon: `i-lucide-${string}`
  tone: NonNullable<KpiTile['tone']>
  /** The state (or archived) filter the tile applies; the total tile carries none. */
  query?: Record<string, string>
}

/** A tile per state over the list's total, in the order the list's filter offers them. */
export function financeStateTiles(
  states: readonly { id: string; icon: `i-lucide-${string}`; tone: NonNullable<KpiTile['tone']> }[],
  totalIcon: `i-lucide-${string}`,
  label: (id: string) => string,
): FinanceListTile[] {
  return [
    { id: 'total', label: label('total'), icon: totalIcon, tone: 'neutral' },
    ...states.map(state => ({ id: state.id, label: label(state.id), icon: state.icon, tone: state.tone, query: { state: state.id } })),
  ]
}

/**
 * The tiles of a finance list. Every tile links to the list with its own base filters and its state; a state tile
 * clears back to the list's total. `counts` holds the server total of each tile, never a count of the loaded page:
 * a list with a `/summary` endpoint (invoices, entries, budgets, assets) fills them from one summary request; a list
 * without one (partners) asks its list endpoint once per tile with `limit=1` and reads `total`.
 */
export function financeListKpiTiles(
  tiles: readonly FinanceListTile[],
  counts: Readonly<Record<string, number | undefined>>,
  path: string,
  base: Record<string, string | number | undefined>,
): KpiTile[] {
  const baseLink = kpiLink(path, base)
  return tiles.map(tile => {
    const to = tile.query ? kpiLink(path, { ...base, ...tile.query }) : baseLink
    return {
      id: tile.id,
      label: tile.label,
      icon: tile.icon,
      tone: tile.tone,
      value: counts[tile.id] ?? null,
      to,
      ...(tile.query ? { clearTo: baseLink } : {}),
    }
  })
}
