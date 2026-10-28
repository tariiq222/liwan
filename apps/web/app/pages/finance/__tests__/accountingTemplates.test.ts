import { readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FinanceAccountListSchema, JournalEntryDetailSchema } from '@webvue/contracts'
import { financeAccountingPreviewData } from '../../../../e2e/finance-accounting-ui-preview-data.mjs'

// The finance accounting pages stay on their templates. This is a source guard, not a behaviour test.
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
  ...sources('pages/finance/accounting'),
  ...sources('components/finance/accounting'),
  'components/finance/AccountPicker.vue',
  'composables/finance/useFinanceEntries.ts',
  'composables/finance/useFinanceAccounts.ts',
]

function leafKeys(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix]
  return Object.entries(value).flatMap(([key, child]) => leafKeys(child, prefix ? `${prefix}.${key}` : key))
}
const locale = (code: string) => JSON.parse(readFileSync(resolve(locales, `${code}/finance-accounting.json`), 'utf8')) as Record<string, unknown>

describe('the finance accounting pages stay on their templates', () => {
  it.each([
    ['pages/finance/accounting/entries/index.vue', ['<SharedListPage', 'v-bind="page"']],
    ['components/finance/accounting/useEntryListPage.ts', ['kpiToggle: true', "kind: 'count'", "can('finance.entries.manage')", 'returnTo']],
    ['components/finance/accounting/EntryList.vue', ['<SharedListCard', 'embedded', '<SharedFilterBar', '<SharedDateField', '<SharedDataTable', ' bare', '<SharedRecordNumber', '#mobile-row', '<SharedStatusBadge', '<SharedListFooter', '<SharedPageState', '<SharedEmptyState', '<EntryKpiStrip', 'useKpiVisibility']],
    ['components/finance/accounting/EntryKpiStrip.vue', ['<SharedKpiStrip']],
    ['pages/finance/accounting/entries/new.vue', ['<SharedCreatePanel', '<SharedForbiddenState', '<EntryList background']],
    ['components/finance/accounting/EntryForm.vue', ['<SharedFormSection panel', '<SharedFormActions', '<SharedUnsavedChanges', 'color="error" variant="subtle"', ':error=']],
    ['pages/finance/accounting/entries/[id].vue', ['<SharedRecordPage', '#aside', '#actions']],
    ['components/finance/accounting/useEntryRecord.ts', ["kind: 'category'", 'statusTag(', 'readFinanceActions(']],
    ['components/finance/accounting/EntryRecordActions.vue', ['<SharedRowActions']],
    ['components/finance/accounting/EntryRecordBody.vue', ['<SharedInlineConfirm', '<UAlert']],
    ['components/finance/accounting/EntryRecordAside.vue', ['<SharedPropertiesPanel', '<SharedPropertyRow']],
    ['components/finance/accounting/EntryLinesPanel.vue', ['<SharedDataTable', ' bare', '#mobile-row']],
    ['pages/finance/accounting/accounts/index.vue', ['<SharedListPage']],
    ['components/finance/accounting/AccountList.vue', ['<SharedListCard', '<SharedDataTable', ' bare', '#mobile-row', '<SharedListFooter', '<SharedPageState', '<SharedEmptyState']],
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
    expect(read('components/finance/accounting/useEntryCreatePage.ts')).toContain("can('finance.entries.manage')")
    expect(read('components/finance/accounting/AccountList.vue')).toContain("can('finance.accounts.read')")
  })
})

describe('the finance accounting locale', () => {
  it('has the same keys in Arabic and English', () => {
    expect(leafKeys(locale('en')).sort()).toEqual(leafKeys(locale('ar')).sort())
  })

  it('has no unused key and no missing key', () => {
    const source = FILES.map(read).join('\n')
    const keys = leafKeys(locale('ar')).map(key => key.replace(/^financeAccounting\./, ''))
    const used = (key: string) => {
      const parent = key.split('.').slice(0, -1).join('.')
      return source.includes(`financeAccounting.${key}`) || source.includes(`financeAccounting.${parent}.\${`)
    }
    expect(keys.filter(key => !used(key))).toEqual([])
    const literal = [...source.matchAll(/financeAccounting\.([A-Za-z.]+[A-Za-z])['`"]/g)].map(match => match[1]!)
    expect(literal.filter(key => !keys.includes(key))).toEqual([])
  })
})

describe('the accounting preview data', () => {
  const serve = (path: string, search = '') => financeAccountingPreviewData(path, new URL(`http://mock${path}${search}`))
  const all = (path: string, search = '') => serve(path, search) as { items: Array<{ id: number }>; total: number }

  it('serves entries and accounts that satisfy the contracts, balanced', () => {
    for (const { id } of all('/api/v1/finance/entries', '?limit=100').items) {
      const entry = JournalEntryDetailSchema.parse(serve(`/api/v1/finance/entries/${id}`))
      const sum = (pick: (line: { debit: number; credit: number }) => number) => entry.lines.reduce((total, line) => total + pick(line), 0)
      expect(sum(line => line.debit)).toBe(sum(line => line.credit))
    }
    expect(FinanceAccountListSchema.parse(all('/api/v1/finance/accounts', '?limit=100')).total).toBeGreaterThan(25)
  })

  it('reports the filtered total, not the page size', () => {
    expect(all('/api/v1/finance/entries', '?state=draft&limit=1')).toMatchObject({ total: 3, items: [{ state: 'draft' }] })
    expect(all('/api/v1/finance/entries', '?date_from=2026-10-01').total).toBe(4)
    expect(all('/api/v1/finance/accounts', '?account_type=expense').total).toBe(5)
  })
})
