import type { ZodType } from 'zod'
import {
  FinanceAgedPartnerBalanceSchema,
  FinanceAnalyticReportSchema,
  FinanceBalanceSheetSchema,
  FinanceBudgetVsActualSchema,
  FinanceCashFlowSchema,
  FinanceGeneralLedgerSchema,
  FinancePartnerStatementSchema,
  FinanceProfitLossSchema,
  FinanceTrialBalanceSchema,
  FinanceVatReturnSchema,
  FinanceVatSummarySchema,
  FinanceWithholdingSummarySchema,
  FinanceZakatBaseSchema,
  type FinanceAgedPartnerBalance,
  type FinanceAnalyticReport,
  type FinanceBalanceSheet,
  type FinanceBudgetVsActual,
  type FinanceCashFlow,
  type FinanceGeneralLedger,
  type FinancePartnerStatement,
  type FinanceProfitLoss,
  type FinanceTrialBalance,
  type FinanceVatReturn,
  type FinanceVatSummary,
  type FinanceWithholdingSummary,
  type FinanceZakatBase,
} from '@webvue/contracts'

export const REPORT_SLUGS = ['trial-balance', 'general-ledger', 'aged-partner-balance', 'partner-statement', 'vat', 'withholding', 'analytic', 'profit-loss', 'balance-sheet', 'zakat-base', 'budget-vs-actual', 'cash-flow', 'vat-return'] as const
export type ReportSlug = (typeof REPORT_SLUGS)[number]

/** A report as the server sent it, tagged with its slug so the page narrows `data` by `slug` alone. */
export type LoadedReport =
  | { slug: 'trial-balance'; data: FinanceTrialBalance }
  | { slug: 'general-ledger'; data: FinanceGeneralLedger }
  | { slug: 'aged-partner-balance'; data: FinanceAgedPartnerBalance }
  | { slug: 'partner-statement'; data: FinancePartnerStatement }
  | { slug: 'vat'; data: FinanceVatSummary }
  | { slug: 'withholding'; data: FinanceWithholdingSummary }
  | { slug: 'analytic'; data: FinanceAnalyticReport }
  | { slug: 'profit-loss'; data: FinanceProfitLoss }
  | { slug: 'balance-sheet'; data: FinanceBalanceSheet }
  | { slug: 'zakat-base'; data: FinanceZakatBase }
  | { slug: 'budget-vs-actual'; data: FinanceBudgetVsActual }
  | { slug: 'cash-flow'; data: FinanceCashFlow }
  | { slug: 'vat-return'; data: FinanceVatReturn }

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
  plan: boolean
  /** A budget the report cannot be asked for without; its `date_to` is optional (the budget's own end). */
  budget: boolean
}

export interface ReportConfig {
  /** The key under `financeReports.reports` for the title and description. */
  key: string
  capability: 'finance.statements.read' | 'finance.reports.read' | 'finance.analytic.read' | 'finance.zakat.read' | 'finance.budgets.read'
  schema: ZodType<LoadedReport>
  filters: ReportFilterSet
  /** An unreviewed management statement: the page says it is not a statutory report. */
  managementInformation?: true
}

const NONE: ReportFilterSet = { period: 'range', targetMove: false, kind: false, partner: false, type: false, account: false, plan: false, budget: false }

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
  analytic: {
    key: 'analytic',
    capability: 'finance.analytic.read',
    schema: FinanceAnalyticReportSchema.transform(data => ({ slug: 'analytic' as const, data })),
    filters: { ...NONE, plan: true },
  },
  'profit-loss': {
    key: 'profitLoss',
    capability: 'finance.statements.read',
    schema: FinanceProfitLossSchema.transform(data => ({ slug: 'profit-loss' as const, data })),
    filters: { ...NONE, targetMove: true },
    managementInformation: true,
  },
  'balance-sheet': {
    key: 'balanceSheet',
    capability: 'finance.statements.read',
    schema: FinanceBalanceSheetSchema.transform(data => ({ slug: 'balance-sheet' as const, data })),
    filters: { ...NONE, period: 'end', targetMove: true },
    managementInformation: true,
  },
  'zakat-base': {
    key: 'zakatBase',
    capability: 'finance.zakat.read',
    schema: FinanceZakatBaseSchema.transform(data => ({ slug: 'zakat-base' as const, data })),
    filters: { ...NONE, period: 'end', targetMove: true },
  },
  'budget-vs-actual': {
    key: 'budgetVsActual',
    capability: 'finance.budgets.read',
    schema: FinanceBudgetVsActualSchema.transform(data => ({ slug: 'budget-vs-actual' as const, data })),
    filters: { ...NONE, period: 'end', budget: true },
  },
  'cash-flow': {
    key: 'cashFlow',
    capability: 'finance.statements.read',
    schema: FinanceCashFlowSchema.transform(data => ({ slug: 'cash-flow' as const, data })),
    filters: NONE,
  },
  'vat-return': {
    key: 'vatReturn',
    capability: 'finance.reports.read',
    schema: FinanceVatReturnSchema.transform(data => ({ slug: 'vat-return' as const, data })),
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
