import type { PageHeaderTag } from '@webvue/ui/app/utils/pageHeaderTag'
import { isolateLtr } from '@webvue/ui/app/utils/formatDate'
import { reportCurrency, type LoadedReport, type ReportSlug } from './reportConfig'
import { reportEndsOnly, type ReportFilters } from './reportParams'

type Translate = (key: string, named?: Record<string, unknown>) => string

/** The tags after a report's title: the period it covers, then its currency (or, for a statement, the partner once it is loaded). */
export function reportHeaderTags(slug: ReportSlug, filters: ReportFilters, report: LoadedReport | undefined, t: Translate): PageHeaderTag[] {
  const period = reportEndsOnly(slug, filters)
    ? t('financeReports.tags.asOf', { date: isolateLtr(filters.dateTo) })
    : t('financeReports.tags.period', { from: isolateLtr(filters.dateFrom), to: isolateLtr(filters.dateTo) })
  const currency = report ? reportCurrency(report) : null
  const partner = report?.slug === 'partner-statement' ? report.data.partner.name : null
  return [
    { label: period, kind: 'schedule', testId: 'finance-report-period' },
    ...(currency ? [{ label: currency, kind: 'category' as const, testId: 'finance-report-currency' }] : []),
    ...(partner ? [{ label: partner, kind: 'person' as const }] : []),
  ]
}
