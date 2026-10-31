import type { LoadedReport } from './reportConfig'

type Translate = (key: string) => string
type Cell = string | number | null

/** A report flattened to what a spreadsheet holds: one header row and plain rows of text and numbers. */
export interface ReportTable {
  title: string
  columns: string[]
  rows: Cell[][]
}

const BUCKETS = ['current', 'days_1_30', 'days_31_60', 'days_61_90', 'days_91_120', 'days_over_120', 'total'] as const

/**
 * The rows of a loaded report, with the column and line names in the user's language: what the page shows, as data.
 * `has` tells whether a locale key exists (a figure the page names itself keeps the server's own label otherwise).
 */
export function reportTable(loaded: LoadedReport, title: string, t: Translate, has: (key: string) => boolean): ReportTable {
  const col = (key: string) => t(`financeReports.columns.${key}`)
  const bucket = (key: string) => t(`financeReports.buckets.${key}`)
  const named = (group: string, line: { code: string; label: string }) => has(`financeReports.mis.${group}.${line.code}`) ? t(`financeReports.mis.${group}.${line.code}`) : line.label
  const lines = (group: string, source: { code: string; label: string; value: number }[]): ReportTable => ({
    title, columns: [col('item'), col('amount')], rows: source.map(line => [named(group, line), line.value]),
  })
  switch (loaded.slug) {
    case 'trial-balance': {
      const { accounts, totals } = loaded.data
      return {
        title,
        columns: [col('code'), col('account'), col('initialBalance'), col('debit'), col('credit'), col('balance'), col('endingBalance')],
        rows: [
          ...accounts.map(row => [row.account.code, row.account.name, row.initial_balance, row.debit, row.credit, row.balance, row.ending_balance]),
          [null, bucket('total'), totals.initial_balance, totals.debit, totals.credit, totals.balance, totals.ending_balance],
        ],
      }
    }
    case 'general-ledger':
      return {
        title,
        columns: [col('code'), col('account'), col('date'), col('entry'), col('partner'), col('label'), col('debit'), col('credit'), col('balance')],
        rows: loaded.data.accounts.flatMap(({ account, lines: ledger, initial_balance, debit, credit, ending_balance }) => [
          [account.code, account.name, null, null, null, col('initialBalance'), null, null, initial_balance],
          ...ledger.items.map(line => [account.code, account.name, line.date, `${line.journal} ${line.entry}`, line.partner?.name ?? null, line.label, line.debit, line.credit, line.balance]),
          [account.code, account.name, null, null, null, col('endingBalance'), debit, credit, ending_balance],
        ]),
      }
    case 'aged-partner-balance': {
      const { accounts, totals } = loaded.data
      return {
        title,
        columns: [col('account'), col('partner'), ...BUCKETS.map(bucket)],
        rows: [
          ...accounts.flatMap(({ account, partners }) => partners.map(row => [`${account.code} ${account.name}`, row.partner?.name ?? t('financeReports.noPartner'), ...BUCKETS.map(key => row[key])])),
          [null, bucket('total'), ...BUCKETS.map(key => totals[key])],
        ],
      }
    }
    case 'partner-statement':
      return {
        title,
        columns: [col('code'), col('date'), col('dueDate'), col('entry'), col('reference'), col('label'), col('debit'), col('credit'), col('openAmount'), col('balance')],
        rows: loaded.data.currencies.flatMap(block => block.lines.map(line => [block.currency, line.date, line.date_due, line.entry, line.ref, line.label, line.debit, line.credit, line.open_amount, line.balance])),
      }
    case 'vat':
      return {
        title,
        columns: [col('section'), col('tax'), col('rate'), col('base'), col('taxAmount')],
        rows: (['sales', 'purchases'] as const).flatMap((section) => {
          const block = loaded.data[section]
          return [
            ...block.taxes.map(row => [t(`financeReports.vat.${section}`), row.tax.name, row.rate, row.base, row.tax_amount]),
            [t(`financeReports.vat.${section}Total`), null, null, block.base, block.tax_amount],
          ]
        }).concat([[t('financeReports.vat.netPayable'), null, null, null, loaded.data.net_payable]]),
      }
    case 'withholding':
      return {
        title,
        columns: [col('tax'), col('rate'), col('base'), col('withheld')],
        rows: [...loaded.data.taxes.map(row => [row.tax.name, row.rate, row.base, row.withheld]), [bucket('total'), null, loaded.data.base, loaded.data.withheld]],
      }
    case 'analytic':
      return {
        title,
        columns: [col('planOrAccount'), col('code'), col('income'), col('expense'), col('net')],
        rows: [
          ...loaded.data.accounts.map(row => [`${row.plan.name} / ${row.account.name}`, row.account.code ?? null, row.income, row.expense, row.net]),
          [bucket('total'), null, loaded.data.totals.income, loaded.data.totals.expense, loaded.data.totals.net],
        ],
      }
    case 'profit-loss': return lines('profitLoss', loaded.data.lines)
    case 'balance-sheet': return lines('balanceSheet', loaded.data.lines)
    case 'zakat-base': return lines('zakatBase', loaded.data.lines)
    case 'budget-vs-actual':
      return {
        title,
        columns: [col('account'), col('label'), col('costCenter'), col('budget'), col('actual'), col('variance')],
        rows: loaded.data.lines.map(line => [`${line.account.name}`, line.label, line.analytic_account?.name ?? null, line.budget, line.actual, line.variance]),
      }
    case 'cash-flow': {
      const { operating, investing, financing } = loaded.data
      const section = (key: string, items: { account: { name: string }; amount: number }[], total: number): Cell[][] => [
        ...items.map(item => [t(`financeReports.cashFlow.sections.${key}`), item.account.name, item.amount]),
        [t(`financeReports.cashFlow.rows.${key}`), null, total],
      ]
      return {
        title,
        columns: [col('section'), col('item'), col('amount')],
        rows: [
          [t('financeReports.cashFlow.rows.opening'), null, loaded.data.opening_cash],
          [t('financeReports.cashFlow.rows.netIncome'), null, operating.net_income],
          ...section('operating', operating.items, operating.total),
          ...section('investing', investing.items, investing.total),
          ...section('financing', financing.items, financing.total),
          [t('financeReports.cashFlow.rows.netChange'), null, loaded.data.net_change],
          [t('financeReports.cashFlow.rows.closing'), null, loaded.data.closing_cash],
        ],
      }
    }
    case 'vat-return':
      return {
        title,
        columns: [t('financeReports.vatReturn.box'), col('item'), t('financeReports.vatReturn.columns.base'), t('financeReports.vatReturn.columns.tax')],
        rows: loaded.data.boxes.map(box => [box.number, has(`financeReports.vatReturn.boxes.${box.code}`) ? t(`financeReports.vatReturn.boxes.${box.code}`) : box.name, box.base, box.tax]),
      }
  }
}

/** A cell as a CSV field; text that a spreadsheet would run as a formula is kept as text. */
function field(cell: Cell): string {
  if (cell === null) return ''
  if (typeof cell === 'number') return String(cell)
  const text = /^[=+\-@\t\r]/.test(cell) ? `'${cell}` : cell
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

/** The CSV text of a table, with a byte order mark so a spreadsheet reads Arabic as UTF-8. */
export function reportCsv(table: ReportTable): string {
  return `﻿${[table.columns, ...table.rows].map(row => row.map(field).join(',')).join('\r\n')}\r\n`
}
