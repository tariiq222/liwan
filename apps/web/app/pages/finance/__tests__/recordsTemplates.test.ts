import { readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// The setup record pages (chart of accounts, journals, taxes, payment terms) stay on their templates. This is a source guard,
// not a behaviour test.
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

const PAGES = ['accounts', 'journals', 'taxes', 'payment-terms'].map(name => `pages/settings/apps/finance/${name}.vue`)
const FILES = [...PAGES, ...sources('components/finance/records'), 'composables/finance/useFinanceRecords.ts']

function leafKeys(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix]
  return Object.entries(value).flatMap(([key, child]) => leafKeys(child, prefix ? `${prefix}.${key}` : key))
}
const locale = (code: string) => JSON.parse(readFileSync(resolve(locales, `${code}/finance-records.json`), 'utf8')) as Record<string, unknown>

describe('the finance setup record pages stay on their templates', () => {
  it.each(PAGES)('%s is a settings page with a forbidden state', (file) => {
    const source = read(file)
    for (const needle of ['<SharedSettingsPage', '<SharedPageHeader', '<SharedForbiddenState', 'can(\'finance.']) expect(source, needle).toContain(needle)
  })

  it.each([
    ['AccountsSection', "can('finance.accounts.manage')"],
    ['JournalsSection', "can('finance.journals.manage')"],
    ['TaxesSection', "can('finance.taxes.manage')"],
    ['PaymentTermsSection', "can('finance.payment_terms.manage')"],
  ])('%s is a record section with the shared list parts and its manage capability', (name, capability) => {
    const source = read(`components/finance/records/${name}.vue`)
    for (const needle of ['<SharedRecordSection variant="panel"', 'useRecordList', '<RecordsFilters', '<SharedDataTable', ' bare', '#mobile-row', '<SharedRowActions', '<SharedStatusBadge', '<SharedListFooter', '<SharedPageState', '<SharedEmptyState', '<RecordArchiveConfirm', capability]) {
      expect(source, needle).toContain(needle)
    }
  })

  it.each(['AccountEditor', 'JournalEditor', 'TaxEditor', 'PaymentTermEditor'])('%s waits for hydration and shows the server error', (name) => {
    const source = read(`components/finance/records/${name}.vue`)
    for (const needle of ['color="error" variant="subtle"', 'saveErrorMessage', ':disabled="!hydrated']) expect(source, needle).toContain(needle)
  })

  it('confirms an archive inline', () => {
    expect(read('components/finance/records/RecordArchiveConfirm.vue')).toContain('<SharedInlineConfirm')
  })

  it('draws no hand-made table, dialog, native confirm or physical-direction class', () => {
    for (const file of FILES) {
      const source = read(file)
      expect(source, file).not.toMatch(/<UTable\b|<USkeleton\b|<table\b|<UModal\b|v-html/)
      expect(source, file).not.toMatch(/<style\b/)
      expect(source, file).not.toMatch(/confirm\(/)
      expect(source, file).not.toMatch(/\b(?:ml|mr|pl|pr|left|right)-\d/)
      expect(source, file).not.toMatch(/rounded-(md|lg|xl|\[)/)
    }
  })

  it('never deletes: the API archives', () => {
    expect(read('composables/finance/useFinanceRecords.ts')).not.toMatch(/method: 'DELETE'/)
  })
})

describe('the finance setup record locale', () => {
  it('has the same keys in Arabic and English', () => {
    expect(leafKeys(locale('en')).sort()).toEqual(leafKeys(locale('ar')).sort())
  })

  it('has every key the sources name literally', () => {
    const source = FILES.map(read).join('\n')
    const keys = leafKeys(locale('ar'))
    const literal = [...source.matchAll(/financeRecords\.([A-Za-z]+(?:\.[A-Za-z]+)+)['`"]/g)].map(match => `financeRecords.${match[1]}`)
    expect(literal.filter(key => !keys.includes(key))).toEqual([])
  })
})
