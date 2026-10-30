import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FinanceBalanceSheetSchema, FinanceProfitLossSchema, FinanceZakatBaseSchema } from '@liwan/contracts'
import { financeReportsPreviewData } from '../../../../e2e/finance-reports-ui-preview-data.mjs'

// The finance report page and its tables stay on the list template. This is a source guard, not a behaviour test.
const app = resolve(import.meta.dirname, '../../..')
const read = (path: string) => readFileSync(resolve(app, path), 'utf8')
const TABLES = ['TrialBalanceTable', 'GeneralLedgerTable', 'AgedBalanceTable', 'PartnerStatementTable', 'VatTable', 'WithholdingTable', 'AnalyticTable', 'MisLinesTable', 'CashFlowTable', 'VatReturnTable']
const FILES = ['pages/finance/reports/[report].vue', 'components/finance/reports/ReportView.vue', 'components/finance/reports/ReportFilters.vue', ...TABLES.map(name => `components/finance/reports/${name}.vue`), 'components/finance/reports/ZakatBaseTable.vue', 'components/finance/reports/VatReturnItems.vue', 'components/finance/reports/ZakatAdjustments.vue', 'components/finance/reports/ZakatReview.vue', 'composables/finance/useFinanceZakat.ts', 'components/finance/budgets/BudgetVarianceTable.vue']

describe('the finance report pages stay on their templates', () => {
  it.each([
    ['pages/finance/reports/[report].vue', ['<ReportView', '<SharedNotFoundState', 'reportSlug']],
    ['components/finance/reports/ReportView.vue', ['<SharedListPage', 'kpi-toggle', '<SharedKpiStrip', 'kpisShown', '<SharedListCard', '<SharedPageState', '<SharedForbiddenState', '<SharedEmptyState', '<SharedListFooter', 'useRouteListFilters', 'can(config.value.capability)']],
    ['components/finance/reports/ReportFilters.vue', ['<SharedFilterBar embedded', '<SharedDateField', '<SharedSegmentedControl', '<PartnerPicker', 'finance-report-plan']],
  ])('%s uses its template', (file, needles) => {
    const source = read(file)
    for (const needle of needles) expect(source, needle).toContain(needle)
  })

  it.each(TABLES)('%s draws a bare data table with a phone row and a totals footer', (name) => {
    const source = read(`components/finance/reports/${name}.vue`)
    for (const needle of ['<SharedDataTable bare', '#mobile-row', 'amountColumn', 'Money']) expect(source, needle).toContain(needle)
    if (!['GeneralLedgerTable', 'MisLinesTable', 'VatReturnTable'].includes(name)) expect(source).toContain('#footer')
  })

  it('draws the Zakat base with its disclaimer always shown above the table', () => {
    const source = read('components/finance/reports/ZakatBaseTable.vue')
    for (const needle of ['<UAlert', 'color="warning"', 'variant="subtle"', 'report.disclaimer', '<MisLinesTable']) expect(source, needle).toContain(needle)
    expect(source).not.toMatch(/v-if=/)
    expect(source.indexOf('<UAlert')).toBeLessThan(source.indexOf('<MisLinesTable'))
  })

  it('shows the VAT return and cash flow notices always, never behind a condition', () => {
    for (const [file, id] of [['VatReturnTable', 'finance-vat-return-notice'], ['CashFlowTable', 'finance-cash-flow-notice']] as const) {
      const source = read(`components/finance/reports/${file}.vue`)
      const alert = source.slice(source.indexOf('<UAlert'), source.indexOf('/>', source.indexOf(id)))
      expect(alert, file).not.toMatch(/v-if=/)
      expect(source.indexOf(id), file).toBeLessThan(source.indexOf('<SharedDataTable'))
    }
    expect(read('components/finance/reports/VatReturnTable.vue')).toContain('<VatReturnItems')
  })

  it('puts the Zakat adjustments and review under the table, each gated by its own capability and never filing', () => {
    expect(read('components/finance/reports/ZakatBaseTable.vue')).toContain('<ZakatAdjustments')
    expect(read('components/finance/reports/ZakatBaseTable.vue')).toContain('<ZakatReview')
    expect(read('components/finance/reports/ZakatAdjustments.vue')).toContain("can('finance.zakat.manage')")
    expect(read('components/finance/reports/ZakatReview.vue')).toContain("can('finance.zakat.review')")
    expect(read('components/finance/reports/ZakatAdjustments.vue')).toContain('<SharedInlineConfirm')
  })

  it('shares the budget variance table between the budget record and the report', () => {
    const table = read('components/finance/budgets/BudgetVarianceTable.vue')
    for (const needle of ['<SharedDataTable bare', '#mobile-row', 'Money']) expect(table, needle).toContain(needle)
    expect(read('components/finance/reports/ReportView.vue')).toContain('<BudgetVarianceTable')
    expect(read('components/finance/budgets/BudgetVsActualPanel.vue')).toContain('<BudgetVarianceTable')
  })

  it('asks for a budget with a select and an empty state until one is chosen', () => {
    expect(read('components/finance/reports/ReportFilters.vue')).toContain('finance-report-budget')
    expect(read('components/finance/reports/ReportView.vue')).toContain('financeReports.pickBudget')
  })

  it('draws no hand-made table, skeleton, dialog or physical-direction class', () => {
    for (const file of FILES) {
      const source = read(file)
      expect(source, file).not.toMatch(/<UTable\b|<USkeleton\b|<table\b|<UModal\b|v-html/)
      expect(source, file).not.toMatch(/<style\b/)
      expect(source, file).not.toMatch(/\b(?:ml|mr|pl|pr|left|right)-\d/)
      expect(source, file).not.toMatch(/rounded-(md|lg|xl|\[)/)
    }
  })

  it('takes every report from the one config table', () => {
    const view = read('components/finance/reports/ReportView.vue')
    expect(view).toContain('REPORTS[props.slug]')
    for (const table of TABLES) expect(view).toContain(`<${table}`)
  })

})

describe('the finance reports locale', () => {
  const locales = resolve(app, '../i18n/locales')
  const locale = (code: string) => JSON.parse(readFileSync(resolve(locales, `${code}/finance-reports.json`), 'utf8')) as Record<string, unknown>
  const leafKeys = (value: unknown, prefix = ''): string[] => typeof value !== 'object' || value === null
    ? [prefix]
    : Object.entries(value).flatMap(([key, child]) => leafKeys(child, prefix ? `${prefix}.${key}` : key))

  it('has the same keys in Arabic and English', () => {
    expect(leafKeys(locale('en')).sort()).toEqual(leafKeys(locale('ar')).sort())
  })

  it('has no unused key and no missing key', () => {
    const source = [...FILES, 'composables/finance/useFinanceReports.ts', 'components/finance/reports/reportKpis.ts', 'components/finance/reports/reportTags.ts'].map(read).join('\n')
    const keys = leafKeys(locale('ar')).map(key => key.replace(/^financeReports\./, ''))
    // A key is used when its path is written out, or when an ancestor is followed by an interpolated part.
    const used = (key: string) => {
      const parts = key.split('.')
      const ancestors = parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('.'))
      return source.includes(`financeReports.${key}`) || ancestors.some(ancestor => source.includes(`financeReports.${ancestor}.\${`))
    }
    expect(keys.filter(key => !used(key))).toEqual([])
    const literal = [...source.matchAll(/financeReports\.([A-Za-z.]+[A-Za-z])['`"]/g)].map(match => match[1]!)
    expect(literal.filter(key => !keys.includes(key))).toEqual([])
  })
})

describe('the MIS report preview data', () => {
  const serve = (slug: string, search = '') => financeReportsPreviewData(`/api/v1/finance/reports/${slug}`, new URL(`http://mock/api/v1/finance/reports/${slug}${search}`))
  const valueOf = (lines: { code: string; value: number }[], code: string) => lines.find(line => line.code === code)!.value

  it('balances the profit and loss and echoes the period and the posting filter', () => {
    const report = FinanceProfitLossSchema.parse(serve('profit-loss', '?date_from=2026-01-01&date_to=2026-03-31&target_move=all'))
    expect(report).toMatchObject({ date_from: '2026-01-01', date_to: '2026-03-31', target_move: 'all', currency: 'SAR', statutory: false, status: 'management_information' })
    expect(valueOf(report.lines, 'gross_profit')).toBe(valueOf(report.lines, 'revenue') - valueOf(report.lines, 'cost_of_revenue'))
    const operating = valueOf(report.lines, 'gross_profit') - valueOf(report.lines, 'operating_expenses') - valueOf(report.lines, 'depreciation')
    expect(valueOf(report.lines, 'operating_profit')).toBe(operating)
    expect(valueOf(report.lines, 'net_profit')).toBe(operating + valueOf(report.lines, 'other_income') - valueOf(report.lines, 'other_expenses'))
  })

  it('serves a balanced balance sheet as of the requested day', () => {
    const report = FinanceBalanceSheetSchema.parse(serve('balance-sheet', '?date_to=2026-06-30'))
    expect(report).toMatchObject({ date_to: '2026-06-30', target_move: 'posted', statutory: false, status: 'management_information' })
    expect(valueOf(report.lines, 'total_assets')).toBe(valueOf(report.lines, 'total_liabilities') + valueOf(report.lines, 'total_equity'))
    expect(valueOf(report.lines, 'total_liabilities_and_equity')).toBe(valueOf(report.lines, 'total_assets'))
    expect(valueOf(report.lines, 'difference')).toBe(0)
  })

  it('serves a Zakat base whose results agree with its lines and carries the disclaimer', () => {
    const report = FinanceZakatBaseSchema.parse(serve('zakat-base', '?date_to=2026-06-30'))
    expect(report.base).toBe(valueOf(report.lines, 'zakat_base'))
    expect(report.base).toBe(valueOf(report.lines, 'total_additions') - valueOf(report.lines, 'total_deductions'))
    expect(report.zakat_due).toBe(valueOf(report.lines, 'zakat_due'))
    expect(report.zakat_due).toBeCloseTo(report.base * report.rate, 2)
    expect(report.disclaimer.length).toBeGreaterThan(20)
  })
})
