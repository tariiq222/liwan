import type { KpiTile } from '@webvue/ui/app/utils/kpiTile'
import type { LoadedReport } from './reportConfig'

type Translate = (key: string) => string
type FormatNumber = (value: number, options?: Intl.NumberFormatOptions) => string

const OVER_90 = ['days_91_120', 'days_over_120'] as const

function currencyFormat(currency: string): Intl.NumberFormatOptions {
  return { style: 'currency', currency, currencyDisplay: 'code' }
}

/**
 * The tiles above a report. Every figure is a total the server sent with the report (or the sum of two of them), never added up
 * from a paged list. A partner statement in several currencies has no single total, and the general ledger sends none: no tiles.
 */
export function reportKpiTiles(report: LoadedReport, t: Translate, n: FormatNumber): KpiTile[] {
  const tile = (id: string, value: number, currency: string, icon: NonNullable<KpiTile['icon']>, tone: KpiTile['tone'] = 'neutral'): KpiTile =>
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
    case 'general-ledger':
      return []
  }
}
