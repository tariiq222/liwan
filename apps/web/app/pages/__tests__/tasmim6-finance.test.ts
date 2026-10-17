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
    for (const needle of ['<SharedListCard', '<FilterBar embedded', '<SharedSegmentedControl']) expect(page).toContain(needle)
    const table = read('components/pmo/projects/finance/FinanceEntryTable.vue')
    expect(table).toContain('<SharedDataTable bare')
    for (const gone of ['useMediaQuery', '<UTable', '<USkeleton']) expect(table).not.toContain(gone)
  })
  it('the entry is a record page and the edit page has no hand-built card', () => {
    const entry = read('pages/projects/[id]/finance/[entryId].vue')
    expect(entry).toContain('<SharedRecordPage')
    expect(entry).toContain('<SharedPropertiesPanel')
    expect(read('pages/projects/[id]/finance/[entryId]/edit.vue')).not.toContain('rounded-lg ring ring-default')
  })
  it('the summary tiles are compact metric tiles with a progress bar and the forms are panels', () => {
    const cards = read('components/pmo/projects/finance/FinanceSummaryCards.vue')
    for (const needle of ['density="compact"', '<SharedProgress', 'remainingTone']) expect(cards).toContain(needle)
    const form = read('components/pmo/projects/finance/FinanceEntryForm.vue')
    expect(form).toContain('<SharedFormSection panel')
    for (const gone of ['space-y-8', 'justify-end', 'gap-5']) expect(form).not.toContain(gone)
  })
})
