import type { ZodType } from 'zod'
import {
  FinanceAgedPartnerBalanceSchema,
  FinanceGeneralLedgerSchema,
  FinancePartnerStatementSchema,
  FinanceTrialBalanceSchema,
  FinanceVatSummarySchema,
  FinanceWithholdingSummarySchema,
  type FinanceAgedPartnerBalance,
  type FinanceGeneralLedger,
  type FinancePartnerStatement,
  type FinanceTrialBalance,
  type FinanceVatSummary,
  type FinanceWithholdingSummary,
} from '@webvue/contracts'

export const REPORT_SLUGS = ['trial-balance', 'general-ledger', 'aged-partner-balance', 'partner-statement', 'vat', 'withholding'] as const
export type ReportSlug = (typeof REPORT_SLUGS)[number]

/** A report as the server sent it, tagged with its slug so the page narrows `data` by `slug` alone. */
export type LoadedReport =
  | { slug: 'trial-balance'; data: FinanceTrialBalance }
  | { slug: 'general-ledger'; data: FinanceGeneralLedger }
  | { slug: 'aged-partner-balance'; data: FinanceAgedPartnerBalance }
  | { slug: 'partner-statement'; data: FinancePartnerStatement }
  | { slug: 'vat'; data: FinanceVatSummary }
  | { slug: 'withholding'; data: FinanceWithholdingSummary }

/**
 * The filters a report takes. `period`: `range` sends `date_from` and `date_to`, `end` only `date_to` (balances as of a day).
 * A partner statement of type `outstanding` is an `end` report whatever its `period` says.
 */
export interface ReportFilterSet {
  period: 'range' | 'end'
  targetMove: boolean
  kind: boolean
  partner: boolean
  type: boolean
  account: boolean
}

export interface ReportConfig {
  /** The key under `financeReports.reports` for the title and description. */
  key: string
  capability: 'finance.statements.read' | 'finance.reports.read'
  schema: ZodType<LoadedReport>
  filters: ReportFilterSet
}

const NONE: ReportFilterSet = { period: 'range', targetMove: false, kind: false, partner: false, type: false, account: false }

export const REPORTS: Record<ReportSlug, ReportConfig> = {
  'trial-balance': {
    key: 'trialBalance',
    capability: 'finance.statements.read',
    schema: FinanceTrialBalanceSchema.transform(data => ({ slug: 'trial-balance' as const, data })),
    filters: { ...NONE, targetMove: true },
  },
  'general-ledger': {
    key: 'generalLedger',
    capability: 'finance.statements.read',
    schema: FinanceGeneralLedgerSchema.transform(data => ({ slug: 'general-ledger' as const, data })),
    filters: { ...NONE, targetMove: true, account: true },
  },
  'aged-partner-balance': {
    key: 'agedPartnerBalance',
    capability: 'finance.statements.read',
    schema: FinanceAgedPartnerBalanceSchema.transform(data => ({ slug: 'aged-partner-balance' as const, data })),
    filters: { ...NONE, period: 'end', targetMove: true, kind: true },
  },
  'partner-statement': {
    key: 'partnerStatement',
    capability: 'finance.statements.read',
    schema: FinancePartnerStatementSchema.transform(data => ({ slug: 'partner-statement' as const, data })),
    filters: { ...NONE, kind: true, partner: true, type: true },
  },
  vat: {
    key: 'vat',
    capability: 'finance.reports.read',
    schema: FinanceVatSummarySchema.transform(data => ({ slug: 'vat' as const, data })),
    filters: NONE,
  },
  withholding: {
    key: 'withholding',
    capability: 'finance.reports.read',
    schema: FinanceWithholdingSummarySchema.transform(data => ({ slug: 'withholding' as const, data })),
    filters: NONE,
  },
}

/** The report a route slug names, or null for an unknown slug. */
export function reportSlug(value: unknown): ReportSlug | null {
  const first = Array.isArray(value) ? value[0] : value
  return REPORT_SLUGS.find(slug => slug === first) ?? null
}

/** The company currency a report is in; a partner statement has one block per document currency instead. */
export function reportCurrency(report: LoadedReport): string | null {
  return report.slug === 'partner-statement' ? null : report.data.currency
}
