import { readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// The setup record pages (chart of accounts, journals, taxes, payment terms, asset profiles) stay on their templates.
// This is a source guard, not a behaviour test.
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

const RESOURCES = ['accounts', 'journals', 'taxes', 'payment-terms', 'asset-profiles'] as const
const LIST_PAGES = RESOURCES.map(name => `pages/settings/apps/finance/${name}/index.vue`)
const CREATE_PAGES = RESOURCES.map(name => `pages/settings/apps/finance/${name}/new.vue`)
const EDIT_PAGES = RESOURCES.map(name => `pages/settings/apps/finance/${name}/[id]/edit.vue`)
const PAGES = [...LIST_PAGES, ...CREATE_PAGES, ...EDIT_PAGES]
const FILES = [...PAGES, ...sources('components/finance/records'), 'composables/finance/useFinanceRecords.ts']

function leafKeys(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix]
  return Object.entries(value).flatMap(([key, child]) => leafKeys(child, prefix ? `${prefix}.${key}` : key))
}
const locale = (code: string) => JSON.parse(readFileSync(resolve(locales, `${code}/finance-records.json`), 'utf8')) as Record<string, unknown>

describe('the finance setup record pages stay on their templates', () => {
  it.each(LIST_PAGES)('%s is a list page with a create link and forbidden state', (file) => {
    const source = read(file)
    for (const needle of ['<SharedListPage', ':create-to="allowed && canManage ?', 'returnToQuery', '<SharedForbiddenState', "can('finance."]) {
      expect(source, needle).toContain(needle)
    }
    expect(source).not.toContain('<SharedSettingsPage')
    expect(source).not.toContain('<SharedPageHeader')
  })

  it.each(CREATE_PAGES)('%s renders the list backdrop and route-backed create panel', (file) => {
    const source = read(file)
    for (const needle of ['<SharedListPage', 'hide-header', 'background', '<SharedCreatePanel', '<SharedForbiddenState', 'safeReturnTo', "can('finance."]) {
      expect(source, needle).toContain(needle)
    }
  })

  it.each(EDIT_PAGES)('%s renders an edit page with a form section and forbidden state', (file) => {
    const source = read(file)
    for (const needle of ['<SharedPageContainer', '<SharedPageHeader', '<SharedPageState', '<SharedFormSection', 'panel', '<SharedForbiddenState', 'safeReturnTo', "can('finance."]) {
      expect(source, needle).toContain(needle)
    }
  })

  it('guards shared payment terms as read only on the edit route', () => {
    const source = read('pages/settings/apps/finance/payment-terms/[id]/edit.vue')
    expect(source).toContain('?.shared')
    expect(source).toContain('financeRecords.paymentTerms.sharedReadOnly')
  })

  it.each([
    ['AccountsSection', "can('finance.accounts.manage')"],
    ['JournalsSection', "can('finance.journals.manage')"],
    ['TaxesSection', "can('finance.taxes.manage')"],
    ['PaymentTermsSection', "can('finance.payment_terms.manage')"],
    ['AssetProfilesSection', "can('finance.assets.manage')"],
  ])('%s is a list card with the shared list parts and its manage capability', (name, capability) => {
    const source = read(`components/finance/records/${name}.vue`)
    for (const needle of ['<SharedListCard', 'defineProps<{ background?: boolean }>', 'useRecordList', '<RecordsFilters', '<SharedDataTable', ' bare', '#mobile-row', '<SharedRowActions', '<SharedStatusBadge', '<SharedListFooter', '<SharedPageState', '<SharedEmptyState', '<RecordArchiveConfirm', 'returnToQuery', capability]) {
      expect(source, needle).toContain(needle)
    }
    expect(source).not.toContain('<SharedRecordSection')
    expect(source).not.toMatch(/Editor\.vue/)
  })

  it('embeds the filter bar in the list card', () => {
    const source = read('components/finance/records/RecordsFilters.vue')
    expect(source).toContain('<SharedFilterBar embedded')
    expect(source).not.toContain('<SharedFilterBar inline')
  })

  it.each(['AccountEditor', 'JournalEditor', 'TaxEditor', 'PaymentTermEditor', 'AssetProfileEditor'])('%s uses unsaved changes, form actions, hydration guard and server errors', (name) => {
    const source = read(`components/finance/records/${name}.vue`)
    for (const needle of ['<SharedUnsavedChanges', '<SharedFormActions', 'color="error" variant="subtle"', 'saveErrorMessage', ':disabled="!hydrated', 'app.saveChanges', 'app.create']) {
      expect(source, needle).toContain(needle)
    }
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
