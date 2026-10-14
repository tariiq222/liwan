import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
const app = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(app, path), 'utf8')

describe('stakeholders stays on its templates', () => {
  it('the list is a hide-header list page over a data table with tone badges', () => {
    const page = read('pages/projects/[id]/stakeholders.vue')
    for (const needle of ['<SharedListPage', 'hide-header', 'create-test-id="stakeholders-create"', '<SharedDataTable', '#mobile-row', '#mobile-row']) expect(page).toContain(needle)
    for (const gone of ['<UTable', 'md:hidden', '<SharedPageHeader']) expect(page).not.toContain(gone)
  })
  it('the delete confirmation follows the live list', () => {
    expect(read('pages/projects/[id]/stakeholders.vue')).toContain('list.data.value?.items.find(item => item.id === confirmDeleteId.value)')
  })
  it('the record is a record page and the edit page has no hand-built card', () => {
    const record = read('pages/projects/[id]/stakeholders/[stakeholderId].vue')
    for (const needle of ['<SharedRecordPage', '<SharedPropertiesPanel', 'data-testid="stakeholder-detail-edit"']) expect(record).toContain(needle)
    expect(read('pages/projects/[id]/stakeholders/[stakeholderId]/edit.vue')).not.toContain('rounded-lg ring ring-default')
  })
})
