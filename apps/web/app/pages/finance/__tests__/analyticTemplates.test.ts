import { readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FinanceAnalyticAccountListSchema, FinanceAnalyticPlanListSchema, FinanceAnalyticReportLineListSchema, FinanceAnalyticReportSchema } from '@webvue/contracts'
import { financeAnalyticPreviewData } from '../../../../e2e/finance-analytic-ui-preview-data.mjs'

// The analytic settings page and the cost center report stay on their templates. This is a source guard, not a behaviour test.
const app = resolve(import.meta.dirname, '../../..')
const locales = resolve(app, '../i18n/locales')
const read = (path: string) => readFileSync(resolve(app, path), 'utf8')

function sources(dir: string): string[] {
  return readdirSync(resolve(app, dir)).flatMap(name => {
    const path = `${dir}/${name}`
    if (statSync(resolve(app, path)).isDirectory()) return name === '__tests__' ? [] : sources(path)
    return /\.(vue|ts)$/.test(name) ? [path] : []
  })
}

const FILES = [
  'pages/settings/apps/finance/analytic.vue',
  ...sources('components/finance/analytic'),
  'components/finance/reports/AnalyticTable.vue',
  'composables/finance/useFinanceAnalytic.ts',
]

function leafKeys(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix]
  return Object.entries(value).flatMap(([key, child]) => leafKeys(child, prefix ? `${prefix}.${key}` : key))
}
const locale = (code: string) => JSON.parse(readFileSync(resolve(locales, `${code}/finance-analytic.json`), 'utf8')) as Record<string, unknown>

describe('the finance analytic pages stay on their templates', () => {
  it.each([
    ['pages/settings/apps/finance/analytic.vue', ['<SharedSettingsPage', '<SharedPageHeader', "kind: 'count'", '<SharedForbiddenState', "can('finance.analytic.read')"]],
    ['components/finance/analytic/AnalyticPlansSection.vue', ['<SharedRecordSection variant="list"', '<SharedRowActions', '<SharedPageState', '<SharedEmptyState', 'canWritePlan(can', 'mustChooseParent(can)']],
    ['components/finance/analytic/AnalyticPlanEditor.vue', ['color="error" variant="subtle"', 'saveErrorMessage', ':disabled="!hydrated']],
    ['components/finance/analytic/AnalyticAccountsSection.vue', ['<SharedRecordSection variant="panel"', 'useRouteListFilters', '<SharedFilterBar', '<SharedDataTable', ' bare', '#mobile-row', '<SharedRowActions', '<SharedStatusBadge', '<SharedListFooter', '<SharedPageState', '<SharedEmptyState', "can('finance.analytic.manage')"]],
    ['components/finance/analytic/AnalyticAccountEditor.vue', ['color="error" variant="subtle"', 'saveErrorMessage', ':disabled="!hydrated']],
    ['components/finance/analytic/AnalyticArchiveConfirm.vue', ['<SharedInlineConfirm']],
    ['components/finance/reports/AnalyticTable.vue', ['<SharedDataTable bare', '#mobile-row', '#footer', 'amountColumn', 'Money', 'accountToggleTo']],
  ])('%s uses its template', (file, needles) => {
    const source = read(file)
    for (const needle of needles) expect(source, needle).toContain(needle)
  })

  it('draws no hand-made table, skeleton, dialog, native confirm or physical-direction class', () => {
    for (const file of FILES) {
      const source = read(file)
      expect(source, file).not.toMatch(/<UTable\b|<USkeleton\b|<table\b|<UModal\b|v-html/)
      expect(source, file).not.toMatch(/<style\b/)
      expect(source, file).not.toMatch(/confirm\(/)
      expect(source, file).not.toMatch(/\b(?:ml|mr|pl|pr|left|right)-\d/)
      expect(source, file).not.toMatch(/rounded-(md|lg|xl|\[)/)
      expect(file, file).not.toMatch(/Badge\.vue$/)
    }
  })

  it('has no delete: the API has none', () => {
    expect(read('composables/finance/useFinanceAnalytic.ts')).not.toMatch(/method: 'DELETE'/)
  })

  it('has no KPI strip on the settings page', () => {
    for (const file of ['pages/settings/apps/finance/analytic.vue', ...sources('components/finance/analytic')]) expect(read(file), file).not.toContain('SharedKpiStrip')
  })
})

describe('the finance analytic locale', () => {
  it('has the same keys in Arabic and English', () => {
    expect(leafKeys(locale('en')).sort()).toEqual(leafKeys(locale('ar')).sort())
  })

  it('has no unused key and no missing key', () => {
    const source = FILES.map(read).join('\n')
    const keys = leafKeys(locale('ar')).map(key => key.replace(/^financeAnalytic\./, ''))
    const used = (key: string) => {
      const parent = key.split('.').slice(0, -1).join('.')
      const leaf = key.split('.').at(-1)!
      return source.includes(`financeAnalytic.${key}`) || source.includes(`financeAnalytic.${parent}.\${`) || (source.includes(`financeAnalytic.${parent}.`) && source.includes(`${leaf}Title`)) || source.includes(`${leaf}Description`)
    }
    expect(keys.filter(key => !used(key))).toEqual([])
    const literal = [...source.matchAll(/financeAnalytic\.([A-Za-z.]+[A-Za-z])['`"]/g)].map(match => match[1]!)
    expect(literal.filter(key => !keys.includes(key))).toEqual([])
  })
})

describe('the analytic preview data', () => {
  const serve = (path: string, search = '') => financeAnalyticPreviewData(path, new URL(`http://mock${path}${search}`))
  const all = (path: string, search = '') => serve(path, search) as { items: Array<{ id: number }>; total: number }

  it('serves plans, cost centers, the report and its lines, all satisfying the contracts', () => {
    expect(FinanceAnalyticPlanListSchema.parse(all('/api/v1/finance/analytic-plans')).total).toBe(3)
    expect(FinanceAnalyticAccountListSchema.parse(all('/api/v1/finance/analytic-accounts', '?archived=true')).total).toBe(2)
    const report = FinanceAnalyticReportSchema.parse(serve('/api/v1/finance/reports/analytic', '?date_from=2026-10-01&date_to=2026-10-31'))
    expect(report.totals.net).toBe(report.totals.income - report.totals.expense)
    for (const row of report.accounts) {
      const lines = FinanceAnalyticReportLineListSchema.parse(serve('/api/v1/finance/reports/analytic/lines', `?account_id=${row.account.id}&date_from=2026-10-01&date_to=2026-10-31`))
      expect(lines.items.reduce((total, line) => total + line.amount, 0)).toBe(row.net)
    }
  })

  it('reports the filtered total, not the page size', () => {
    expect(all('/api/v1/finance/analytic-accounts', '?plan_id=2&limit=1')).toMatchObject({ total: 3, items: [{ id: 5 }] })
    expect(all('/api/v1/finance/analytic-accounts', '?q=jed').total).toBe(1)
    expect(all('/api/v1/finance/analytic-accounts', '?archived=false').total).toBe(10)
    expect(FinanceAnalyticReportSchema.parse(serve('/api/v1/finance/reports/analytic', '?plan_id=2')).accounts.every(row => row.plan.id === 2)).toBe(true)
  })
})
