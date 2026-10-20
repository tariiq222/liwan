import type {
  FinanceAgedPartnerBalance,
  FinanceAnalyticReport,
  FinanceAnalyticReportLine,
  FinanceGeneralLedger,
  FinancePartnerStatement,
  FinanceVatSummary,
} from '@webvue/contracts'

type AgedBuckets = FinanceAgedPartnerBalance['totals']
type LedgerAccount = FinanceGeneralLedger['accounts'][number]
type LedgerLine = LedgerAccount['lines']['items'][number]
type VatRow = FinanceVatSummary['sales']['taxes'][number]

export const AGED_BUCKETS = ['current', 'days_1_30', 'days_31_60', 'days_61_90', 'days_91_120', 'days_over_120', 'total'] as const satisfies readonly (keyof AgedBuckets)[]

/** The general ledger as one table: each account, and under the selected one the page of its lines. */
export type LedgerRow =
  | { kind: 'account'; key: string; account: LedgerAccount }
  | { kind: 'line'; key: string; line: LedgerLine }

export function ledgerRows(report: FinanceGeneralLedger, selectedId: number | null): LedgerRow[] {
  return report.accounts.flatMap<LedgerRow>(account => [
    { kind: 'account', key: `a${account.account.id}`, account },
    ...(account.account.id === selectedId ? account.lines.items.map<LedgerRow>(line => ({ kind: 'line', key: `l${line.id}`, line })) : []),
  ])
}

/** The selected account's lines, with the period's line count that pages them. */
export function selectedLedgerLines(report: FinanceGeneralLedger, selectedId: number | null): LedgerAccount['lines'] | null {
  return report.accounts.find(account => account.account.id === selectedId)?.lines ?? null
}

/** The aged balances as one table: each account, then its partners. */
export type AgedRow =
  | { kind: 'account'; key: string; name: string; code: string; buckets: AgedBuckets }
  | { kind: 'partner'; key: string; name: string | null; buckets: AgedBuckets }

export function agedRows(report: FinanceAgedPartnerBalance): AgedRow[] {
  return report.accounts.flatMap<AgedRow>(({ account, partners, ...buckets }) => [
    { kind: 'account', key: `a${account.id}`, name: account.name, code: account.code, buckets },
    ...partners.map<AgedRow>(({ partner, ...partnerBuckets }) => ({ kind: 'partner', key: `a${account.id}p${partner?.id ?? 0}`, name: partner?.name ?? null, buckets: partnerBuckets })),
  ])
}

/** The statement lines of every currency in one table; each row names its currency. */
export interface StatementRow {
  key: string
  currency: string
  /** The opening row of a currency block; its `balance` is the balance forward. */
  forward: boolean
  date: string | null
  dateDue: string | null
  entry: string
  ref: string
  label: string
  debit: number
  credit: number
  openAmount: number
  balance: number | null
}

export function statementRows(report: FinancePartnerStatement): StatementRow[] {
  return report.currencies.flatMap<StatementRow>((block, index) => [
    { key: `f${index}`, currency: block.currency, forward: true, date: null, dateDue: null, entry: '', ref: '', label: '', debit: 0, credit: 0, openAmount: 0, balance: block.balance_forward },
    ...block.lines.map<StatementRow>((line, position) => ({
      key: `c${index}l${position}`,
      currency: block.currency,
      forward: false,
      date: line.date,
      dateDue: line.date_due,
      entry: line.entry,
      ref: line.ref,
      label: line.label,
      debit: line.debit,
      credit: line.credit,
      openAmount: line.open_amount,
      balance: line.balance,
    })),
  ])
}

/** The VAT summary as one table: the taxes of each section, then the section total. */
export interface VatTableRow {
  key: string
  section: 'sales' | 'purchases'
  /** The tax; null on a section total. */
  tax: VatRow['tax'] | null
  rate: number | null
  base: number
  taxAmount: number
}

export function vatRows(report: FinanceVatSummary): VatTableRow[] {
  return (['sales', 'purchases'] as const).flatMap<VatTableRow>(section => [
    ...report[section].taxes.map<VatTableRow>(row => ({ key: `${section}${row.tax.id}`, section, tax: row.tax, rate: row.rate, base: row.base, taxAmount: row.tax_amount })),
    { key: `${section}-total`, section, tax: null, rate: null, base: report[section].base, taxAmount: report[section].tax_amount },
  ])
}

/** The cost center report as one table: each cost center, and under the selected one the page of its analytic items. */
export type AnalyticRow =
  | { kind: 'account'; key: string; row: FinanceAnalyticReport['accounts'][number] }
  | { kind: 'line'; key: string; line: FinanceAnalyticReportLine }

export function analyticRows(report: FinanceAnalyticReport, selectedId: number | null, lines: readonly FinanceAnalyticReportLine[]): AnalyticRow[] {
  return report.accounts.flatMap<AnalyticRow>(row => [
    { kind: 'account', key: `a${row.account.id}`, row },
    ...(row.account.id === selectedId ? lines.map<AnalyticRow>(line => ({ kind: 'line', key: `l${line.id}`, line })) : []),
  ])
}
