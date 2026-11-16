import type { SalesReportSummary } from '@liwan/contracts'
import type { KpiTile } from '@liwan/ui/app/utils/kpiTile'
import { formatCurrency } from './formatCurrency'

type Translate = (key: string, named?: Record<string, unknown>) => string

/**
 * The four tiles above the report: what was confirmed (orders and total), the open quotations, and the cancelled
 * documents. Every amount is in the company currency the server names; the untaxed amount rides in the hint.
 */
export function salesReportTiles(summary: SalesReportSummary, t: Translate, locale: string): KpiTile[] {
  const money = (amount: number) => formatCurrency(amount, summary.currency.name, locale)
  const { confirmed, quotations, cancelled } = summary
  return [
    { id: 'confirmedOrders', label: t('sales.reports.tiles.confirmedOrders'), icon: 'i-lucide-circle-check', tone: 'success', value: confirmed.orders },
    { id: 'confirmedTotal', label: t('sales.reports.tiles.confirmedTotal'), icon: 'i-lucide-banknote', tone: 'success', value: money(confirmed.amount_total), hint: t('sales.reports.tiles.untaxed', { amount: money(confirmed.amount_untaxed) }) },
    { id: 'quotations', label: t('sales.reports.tiles.quotations'), icon: 'i-lucide-file-text', tone: 'neutral', value: quotations.orders, hint: t('sales.reports.tiles.total', { amount: money(quotations.amount_total) }) },
    { id: 'cancelled', label: t('sales.reports.tiles.cancelled'), icon: 'i-lucide-circle-x', tone: cancelled.orders ? 'warning' : 'neutral', value: cancelled.orders, hint: t('sales.reports.tiles.total', { amount: money(cancelled.amount_total) }) },
  ]
}

/** The text of a period group's `key`: the ISO day it starts on, shown as a month for a month period. */
export function periodLabel(key: string, period: 'day' | 'week' | 'month', locale: string): string {
  const date = new Date(`${key}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return key
  const options: Intl.DateTimeFormatOptions = period === 'month' ? { year: 'numeric', month: 'long' } : { year: 'numeric', month: 'short', day: 'numeric' }
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(date)
}
