import type { PageHeaderTag } from '@liwan/ui/app/utils/pageHeaderTag'
import { isolateLtr } from '@liwan/ui/app/utils/formatDate'
import { reportCurrency, type LoadedReport, type ReportSlug } from './reportConfig'
import { reportEndsOnly, type ReportFilters } from './reportParams'

type Translate = (key: string, named?: Record<string, unknown>) => string

/** The tags after a report's title: the period it covers, then its currency (or, for a statement, the partner once it is loaded). */
export function reportHeaderTags(slug: ReportSlug, filters: ReportFilters, report: LoadedReport | undefined, t: Translate): PageHeaderTag[] {
  const period = reportPeriod(slug, filters, report, t)
  const currency = report ? reportCurrency(report) : null
  const partner = report?.slug === 'partner-statement' ? report.data.partner.name : null
  return [
    ...(period ? [{ label: period, kind: 'schedule' as const, testId: 'finance-report-period' }] : []),
    ...(currency ? [{ label: currency, kind: 'category' as const, testId: 'finance-report-currency' }] : []),
    ...(partner ? [{ label: partner, kind: 'person' as const }] : []),
  ]
}

/** The period text; a budget comparison names the budget's own days once loaded and, until then, a day only if the URL gave one. */
function reportPeriod(slug: ReportSlug, filters: ReportFilters, report: LoadedReport | undefined, t: Translate): string | null {
  if (report?.slug === 'budget-vs-actual') return t('financeReports.tags.period', { from: isolateLtr(report.data.date_from), to: isolateLtr(report.data.date_to) })
  if (slug === 'budget-vs-actual' && !filters.dateToSet) return null
  return reportEndsOnly(slug, filters)
    ? t('financeReports.tags.asOf', { date: isolateLtr(filters.dateTo) })
    : t('financeReports.tags.period', { from: isolateLtr(filters.dateFrom), to: isolateLtr(filters.dateTo) })
}
