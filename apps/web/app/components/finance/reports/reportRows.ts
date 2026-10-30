import type {
  FinanceAgedPartnerBalance,
  FinanceAnalyticReport,
  FinanceAnalyticReportLine,
  FinanceCashFlow,
  FinanceGeneralLedger,
  FinancePartnerStatement,
  FinanceReportLine,
  FinanceVatReturn,
  FinanceVatSummary,
} from '@liwan/contracts'

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

/** The reports made of `{code, label, value}` lines; the code names their locale keys under `financeReports.mis`. */
export type MisKind = 'profitLoss' | 'balanceSheet' | 'zakatBase'

/** The codes that close a group of lines (subtotals and totals): drawn bold. */
const MIS_STRONG: Record<MisKind, readonly string[]> = {
  profitLoss: ['gross_profit', 'operating_profit', 'net_profit'],
  balanceSheet: ['current_assets', 'non_current_assets', 'total_assets', 'current_liabilities', 'non_current_liabilities', 'total_liabilities', 'total_equity', 'total_liabilities_and_equity'],
  zakatBase: ['adjusted_net_profit', 'total_additions', 'total_deductions'],
}

/** The Zakat results the server sends as lines and again at the top level; the table leaves them to the totals line. */
export const ZAKAT_RESULT_CODES = ['zakat_base', 'zakat_rate', 'zakat_due'] as const

export interface MisRow {
  code: string
  /** The server's English description, the label of a code the locale does not know. */
  label: string
  value: number
  strong: boolean
}

export function misRows(kind: MisKind, lines: readonly FinanceReportLine[], hidden: readonly string[] = []): MisRow[] {
  return lines
    .filter(line => !hidden.includes(line.code))
    .map(line => ({ code: line.code, label: line.label, value: line.value, strong: MIS_STRONG[kind].includes(line.code) }))
}

/** The line a report's code names, or undefined when the server sent none. */
export function misValue(lines: readonly Pick<FinanceReportLine, 'code' | 'value'>[], code: string): number | undefined {
  return lines.find(line => line.code === code)?.value
}

/** The statement of cash flows as one list: a heading per activity, its items, a subtotal; then the opening, closing and check lines. */
export type CashFlowRow =
  | { kind: 'item'; key: string; label: string; amount: number }
  | { kind: 'item'; key: string; labelKey: string; amount: number }
  | { kind: 'total'; key: string; labelKey: string; amount: number }

export function cashFlowRows(report: FinanceCashFlow): CashFlowRow[] {
  const items = (prefix: string, rows: FinanceCashFlow['investing']['items']): CashFlowRow[] =>
    rows.map(row => ({ kind: 'item', key: `${prefix}-${row.account.id}`, label: `${row.account.code} ${row.account.name}`, amount: row.amount }))
  const { operating, investing, financing } = report
  return [
    { kind: 'item', key: 'net-income', labelKey: 'netIncome', amount: operating.net_income },
    ...operating.adjustments.map<CashFlowRow>(row => ({ kind: 'item', key: `adjustment-${row.key}`, labelKey: row.key, amount: row.amount })),
    ...items('operating', operating.items),
    { kind: 'total', key: 'operating', labelKey: 'operating', amount: operating.total },
    ...items('investing', investing.items),
    ...(investing.depreciation_reclass ? [{ kind: 'item' as const, key: 'reclass', labelKey: 'depreciationReclass', amount: investing.depreciation_reclass }] : []),
    { kind: 'total', key: 'investing', labelKey: 'investing', amount: investing.total },
    ...items('financing', financing.items),
    { kind: 'total', key: 'financing', labelKey: 'financing', amount: financing.total },
    { kind: 'total', key: 'net-change', labelKey: 'netChange', amount: report.net_change },
    { kind: 'item', key: 'opening', labelKey: 'opening', amount: report.opening_cash },
    { kind: 'total', key: 'closing', labelKey: 'closing', amount: report.closing_cash },
  ]
}

/** A VAT return box has a base, a tax, or both; the drill-down opens one of them. */
export interface VatReturnCell { code: string; column: 'base' | 'tax'; amount: number }
export const vatReturnCells = (box: FinanceVatReturn['boxes'][number]): VatReturnCell[] =>
  (['base', 'tax'] as const).flatMap(column => box[column] === null ? [] : [{ code: box.code, column, amount: box[column] }])
