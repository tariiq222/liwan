import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// The finance report page and its tables stay on the list template. This is a source guard, not a behaviour test.
const app = resolve(import.meta.dirname, '../../..')
const read = (path: string) => readFileSync(resolve(app, path), 'utf8')
const TABLES = ['TrialBalanceTable', 'GeneralLedgerTable', 'AgedBalanceTable', 'PartnerStatementTable', 'VatTable', 'WithholdingTable', 'AnalyticTable']
const FILES = ['pages/finance/reports/[report].vue', 'components/finance/reports/ReportView.vue', 'components/finance/reports/ReportFilters.vue', ...TABLES.map(name => `components/finance/reports/${name}.vue`)]

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
    if (name !== 'GeneralLedgerTable') expect(source).toContain('#footer')
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
