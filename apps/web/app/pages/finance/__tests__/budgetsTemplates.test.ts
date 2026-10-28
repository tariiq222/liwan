import { readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FinanceBudgetDetailSchema, FinanceBudgetListSchema, FinanceBudgetVsActualSchema } from '@webvue/contracts'
import { financeBudgetsPreviewData } from '../../../../e2e/finance-budgets-ui-preview-data.mjs'

// The finance budgets pages stay on their templates. This is a source guard, not a behaviour test.
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
  ...sources('pages/finance/budgets'),
  ...sources('components/finance/budgets'),
  'composables/finance/useFinanceBudgets.ts',
]

function leafKeys(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix]
  return Object.entries(value).flatMap(([key, child]) => leafKeys(child, prefix ? `${prefix}.${key}` : key))
}
const locale = (code: string) => JSON.parse(readFileSync(resolve(locales, `${code}/finance-budgets.json`), 'utf8')) as Record<string, unknown>

describe('the finance budgets pages stay on their templates', () => {
  it.each([
    ['pages/finance/budgets/index.vue', ['<SharedListPage', 'v-bind="page"']],
    ['components/finance/budgets/useBudgetListPage.ts', ['kpiToggle: true', "kind: 'count'", "can('finance.budgets.manage')", 'returnTo']],
    ['components/finance/budgets/BudgetList.vue', ['<SharedListCard', 'embedded', '<SharedFilterBar', '<SharedDataTable', ' bare', '<SharedRecordNumber', '#mobile-row', '<SharedStatusBadge', '<SharedListFooter', '<SharedPageState', '<SharedEmptyState', '<BudgetKpiStrip', 'useKpiVisibility', "can('finance.budgets.read')"]],
    ['components/finance/budgets/BudgetKpiStrip.vue', ['<SharedKpiStrip']],
    ['pages/finance/budgets/new.vue', ['<SharedCreatePanel', '<SharedForbiddenState', '<BudgetList background']],
    ['components/finance/budgets/BudgetForm.vue', ['<SharedFormSection panel', '<SharedFormActions', '<SharedUnsavedChanges', '<SharedDateField', 'color="error" variant="subtle"', ':error=']],
    ['pages/finance/budgets/[id].vue', ['<SharedRecordPage', '#aside', '#actions']],
    ['components/finance/budgets/useBudgetRecord.ts', ["kind: 'category'", "kind: 'schedule'", 'statusTag(', 'readFinanceActions(']],
    ['components/finance/budgets/BudgetRecordActions.vue', ['<SharedRowActions']],
    ['components/finance/budgets/BudgetRecordBody.vue', ['<SharedInlineConfirm', '<UAlert', '<BudgetLinesPanel', '<BudgetVsActualPanel']],
    ['components/finance/budgets/BudgetRecordAside.vue', ['<SharedPropertiesPanel', '<SharedPropertyRow']],
    ['components/finance/budgets/BudgetLinesPanel.vue', ['<SharedRecordSection', '<SharedDataTable', ' bare', '#mobile-row', '<BudgetLineForm']],
    ['components/finance/budgets/BudgetLineForm.vue', ['<AccountPicker', 'color="error" variant="subtle"', ':error=']],
    ['components/finance/budgets/BudgetVsActualPanel.vue', ['<SharedRecordSection', '<BudgetVarianceTable', '#actions', '/finance/reports/budget-vs-actual?budget_id=', '<SharedMetricTile', 'density="compact"', '<SharedPageState']],
    ['components/finance/budgets/BudgetVarianceTable.vue', ['<SharedDataTable', ' bare', '#mobile-row', '<SharedStatusBadge']],
  ])('%s uses its template', (file, needles) => {
    const source = read(file)
    for (const needle of needles) expect(source, needle).toContain(needle)
  })

  it('draws no hand-made table, skeleton, badge or physical-direction class', () => {
    for (const file of FILES) {
      const source = read(file)
      expect(source, file).not.toMatch(/<UTable\b/)
      expect(source, file).not.toMatch(/<USkeleton\b/)
      expect(source, file).not.toMatch(/v-html/)
      expect(source, file).not.toMatch(/<style\b/)
      expect(source, file).not.toMatch(/md:hidden/)
      expect(source, file).not.toMatch(/\b(?:ml|mr|pl|pr|left|right)-\d/)
      expect(source, file).not.toMatch(/rounded-(md|lg|xl|\[)/)
      expect(file, file).not.toMatch(/Badge\.vue$/)
    }
  })

  it('gates every write control behind its capability', () => {
    expect(read('components/finance/budgets/useBudgetCreatePage.ts')).toContain("can('finance.budgets.manage')")
  })
})

describe('the finance budgets locale', () => {
  it('has the same keys in Arabic and English', () => {
    expect(leafKeys(locale('en')).sort()).toEqual(leafKeys(locale('ar')).sort())
  })

  it('has no unused key and no missing key', () => {
    const source = FILES.map(read).join('\n')
    const keys = leafKeys(locale('ar')).map(key => key.replace(/^financeBudgets\./, ''))
    const used = (key: string) => {
      const parent = key.split('.').slice(0, -1).join('.')
      return source.includes(`financeBudgets.${key}`) || source.includes(`financeBudgets.${parent}.\${`)
    }
    expect(keys.filter(key => !used(key))).toEqual([])
    const literal = [...source.matchAll(/financeBudgets\.([A-Za-z.]+[A-Za-z])['`"]/g)].map(match => match[1]!)
    expect(literal.filter(key => !keys.includes(key))).toEqual([])
  })
})

describe('the budgets preview data', () => {
  const serve = (path: string, search = '') => financeBudgetsPreviewData(path, new URL(`http://mock${path}${search}`))
  const list = (search = '') => FinanceBudgetListSchema.parse(serve('/api/v1/finance/budgets', search))

  it('serves budgets in every state whose line count matches their lines', () => {
    const { items, total } = list('?limit=100')
    expect(total).toBe(6)
    expect(new Set(items.map(item => item.state))).toEqual(new Set(['draft', 'confirmed', 'cancelled']))
    for (const item of items) {
      const detail = FinanceBudgetDetailSchema.parse(serve(`/api/v1/finance/budgets/${item.id}`))
      expect(detail.lines.length).toBe(item.line_count)
      expect(detail.lines.length).toBeGreaterThanOrEqual(4)
      expect(detail.lines.length).toBeLessThanOrEqual(8)
    }
  })

  it('reports the filtered total, not the page size', () => {
    expect(list('?state=confirmed&limit=1')).toMatchObject({ total: 3, items: [{ state: 'confirmed' }] })
    expect(list('?q=2027').total).toBe(2)
  })

  it('compares every budget with consistent totals and both outcomes', () => {
    let favorable = 0
    let unfavorable = 0
    for (const { id } of list('?limit=100').items) {
      const report = FinanceBudgetVsActualSchema.parse(serve('/api/v1/finance/reports/budget-vs-actual', `?budget_id=${id}`))
      const sum = (nature: 'debit' | 'credit', pick: (line: { budget: number; actual: number }) => number) =>
        report.lines.filter(line => line.nature === nature).reduce((total, line) => total + pick(line), 0)
      expect(report.totals.debit.budget).toBe(sum('debit', line => line.budget))
      expect(report.totals.credit.actual).toBe(sum('credit', line => line.actual))
      expect(report.totals.net.budget).toBe(report.totals.credit.budget - report.totals.debit.budget)
      for (const line of report.lines) {
        expect(line.variance).toBe(Math.round((line.budget - line.actual) * 100) / 100)
        if (line.favorable) favorable += 1
        else unfavorable += 1
      }
    }
    expect(favorable).toBeGreaterThan(0)
    expect(unfavorable).toBeGreaterThan(0)
  })
})
