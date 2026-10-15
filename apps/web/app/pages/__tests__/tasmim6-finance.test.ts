import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
const app = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(app, path), 'utf8')

describe('finance stays on its templates', () => {
  it('the ledger is a hide-header list page and the table a data table', () => {
    const page = read('pages/projects/[id]/finance.vue')
    for (const needle of ['<SharedListPage', 'hide-header', 'liveListPath']) expect(page).toContain(needle)
    expect(page).not.toContain('<SharedPageHeader')
    const table = read('components/pmo/projects/finance/FinanceEntryTable.vue')
    expect(table).toContain('<SharedDataTable')
    for (const gone of ['useMediaQuery', '<UTable', '<USkeleton']) expect(table).not.toContain(gone)
  })
  it('the entry is a record page and the edit page has no hand-built card', () => {
    const entry = read('pages/projects/[id]/finance/[entryId].vue')
    expect(entry).toContain('<SharedRecordPage')
    expect(entry).toContain('<SharedPropertiesPanel')
    expect(read('pages/projects/[id]/finance/[entryId]/edit.vue')).not.toContain('rounded-lg ring ring-default')
  })
})
