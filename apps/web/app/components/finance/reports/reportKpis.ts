import type { FinanceReportLine } from '@liwan/contracts'
import type { KpiTile } from '@liwan/ui/app/utils/kpiTile'
import type { LoadedReport } from './reportConfig'
import { misValue } from './reportRows'
import { sideTone } from '../budgets/budgetFigures'

type Translate = (key: string, named?: Record<string, unknown>) => string
type FormatNumber = (value: number, options?: Intl.NumberFormatOptions) => string
type MisLines = readonly Pick<FinanceReportLine, 'code' | 'value'>[]
type Tile = (id: string, value: number, currency: string, icon: NonNullable<KpiTile['icon']>, tone?: KpiTile['tone']) => KpiTile

const OVER_90 = ['days_91_120', 'days_over_120'] as const

function currencyFormat(currency: string): Intl.NumberFormatOptions {
  return { style: 'currency', currency, currencyDisplay: 'code' }
}

/**
 * The tiles above a report. Every figure is a total the server sent with the report (or the sum of two of them), never added up
 * from a paged list. A partner statement in several currencies has no single total, and the general ledger sends none: no tiles.
 */
export function reportKpiTiles(report: LoadedReport, t: Translate, n: FormatNumber): KpiTile[] {
  const tile: Tile = (id, value, currency, icon, tone = 'neutral') =>
    ({ id, label: t(`financeReports.kpi.${id}`), value: n(value, currencyFormat(currency)), icon, tone })
  switch (report.slug) {
    case 'trial-balance': {
      const { totals } = report.data
      const difference = totals.debit - totals.credit
      return [
        tile('debit', totals.debit, report.data.currency, 'i-lucide-arrow-down-left'),
        tile('credit', totals.credit, report.data.currency, 'i-lucide-arrow-up-right'),
        tile('difference', difference, report.data.currency, 'i-lucide-scale', difference === 0 ? 'success' : 'danger'),
      ]
    }
    case 'aged-partner-balance': {
      const { totals, currency } = report.data
      const overNinety = OVER_90.reduce((sum, bucket) => sum + totals[bucket], 0)
      return [
        tile('agedTotal', totals.total, currency, 'i-lucide-hourglass'),
        tile('agedCurrent', totals.current, currency, 'i-lucide-calendar-check', 'success'),
        tile('agedOver90', overNinety, currency, 'i-lucide-calendar-x', overNinety > 0 ? 'danger' : 'neutral'),
      ]
    }
    case 'partner-statement': {
      const [only, ...others] = report.data.currencies
      if (!only || others.length) return []
      return [
        tile('amountDue', only.amount_due, only.currency, 'i-lucide-hand-coins', only.amount_due > 0 ? 'warning' : 'neutral'),
        tile('endingBalance', only.ending_balance, only.currency, 'i-lucide-wallet'),
      ]
    }
    case 'vat': {
      const { sales, purchases, net_payable: net, currency } = report.data
      return [
        tile('salesTax', sales.tax_amount, currency, 'i-lucide-receipt'),
        tile('purchaseTax', purchases.tax_amount, currency, 'i-lucide-shopping-cart'),
        tile('netPayable', net, currency, 'i-lucide-percent', net > 0 ? 'warning' : 'success'),
      ]
    }
    case 'withholding': {
      const { base, withheld, currency } = report.data
      return [
        tile('withholdingBase', base, currency, 'i-lucide-receipt'),
        tile('withheld', withheld, currency, 'i-lucide-hand-coins', 'warning'),
      ]
    }
    case 'analytic': {
      const { totals, currency } = report.data
      return [
        tile('income', totals.income, currency, 'i-lucide-trending-up', 'success'),
        tile('expense', totals.expense, currency, 'i-lucide-trending-down'),
        tile('net', totals.net, currency, 'i-lucide-scale', totals.net < 0 ? 'danger' : 'neutral'),
      ]
    }
    case 'profit-loss':
      return profitLossTiles(report.data, tile)
    case 'balance-sheet':
      return lineTiles(report.data.lines, report.data.currency, tile, [
        ['totalAssets', 'total_assets', 'i-lucide-landmark'],
        ['totalLiabilities', 'total_liabilities', 'i-lucide-hand-coins'],
        ['equity', 'total_equity', 'i-lucide-scale'],
      ])
    case 'zakat-base': {
      const { base, rate, zakat_due: due, currency } = report.data
      return [
        tile('zakatBase', base, currency, 'i-lucide-landmark'),
        { id: 'zakatRate', label: t('financeReports.kpi.zakatRate'), value: n(rate, { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 }), icon: 'i-lucide-percent', tone: 'neutral' },
        tile('zakatDue', due, currency, 'i-lucide-hand-coins', due > 0 ? 'warning' : 'neutral'),
      ]
    }
    case 'budget-vs-actual': {
      const { totals, currency } = report.data
      const side = (id: 'debit' | 'credit', icon: NonNullable<KpiTile['icon']>): KpiTile => ({
        ...tile(`budget${id === 'debit' ? 'Debit' : 'Credit'}`, totals[id].actual, currency, icon, sideTone(id, totals[id])),
        hint: t('financeReports.kpi.budgetOf', { amount: n(totals[id].budget, currencyFormat(currency)) }),
      })
      return [side('debit', 'i-lucide-arrow-down-left'), side('credit', 'i-lucide-arrow-up-right'), tile('budgetNet', totals.net.actual, currency, 'i-lucide-scale')]
    }
    case 'cash-flow': {
      const { opening_cash: opening, closing_cash: closing, difference, currency } = report.data
      return [
        tile('cashOpening', opening, currency, 'i-lucide-wallet'),
        tile('cashClosing', closing, currency, 'i-lucide-landmark'),
        tile('cashDifference', difference, currency, 'i-lucide-scale', difference === 0 ? 'success' : 'danger'),
      ]
    }
    case 'vat-return': {
      const net = report.data.boxes.find(box => box.number === 16)?.tax
      return net === undefined || net === null ? [] : [tile('netPayable', net, report.data.currency, 'i-lucide-percent', net > 0 ? 'warning' : 'success')]
    }
    case 'general-ledger':
      return []
  }
}

/** A tile per `[tile id, line code, icon]` for the lines the server sent. */
function lineTiles(lines: MisLines, currency: string, tile: Tile, wanted: readonly (readonly [string, string, NonNullable<KpiTile['icon']>])[]): KpiTile[] {
  return wanted.flatMap(([id, code, icon]) => {
    const value = misValue(lines, code)
    return value === undefined ? [] : [tile(id, value, currency, icon)]
  })
}

function profitLossTiles({ lines, currency }: { lines: MisLines; currency: string }, tile: Tile): KpiTile[] {
  const net = misValue(lines, 'net_profit')
  return [
    ...lineTiles(lines, currency, tile, [['revenue', 'revenue', 'i-lucide-trending-up'], ['grossProfit', 'gross_profit', 'i-lucide-coins']]),
    ...(net === undefined ? [] : [tile('netProfit', net, currency, 'i-lucide-scale', net < 0 ? 'danger' : 'neutral')]),
  ]
}
