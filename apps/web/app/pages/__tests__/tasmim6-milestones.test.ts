import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
const app = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(app, path), 'utf8')

describe('milestones stay on their templates', () => {
  it('the list page is a hide-header list page with the existing create test id', () => {
    const page = read('pages/projects/[id]/milestones.vue')
    for (const needle of ['<SharedListPage', 'hide-header', 'create-test-id="project-header-create"']) expect(page).toContain(needle)
    expect(page).not.toContain('<SharedPageHeader')
    expect(page).not.toContain('<USkeleton')
  })
  it('the table renders through SharedDataTable with a phone row and no card of its own', () => {
    const table = read('components/pmo/projects/MilestoneTable.vue')
    expect(table).toContain('<SharedDataTable')
    expect(table).toContain('#mobile-row')
    for (const gone of ['<UCard', '<USkeleton', '<UBadge', 'divide-y']) expect(table).not.toContain(gone)
  })
  it('the delete confirmation follows the live list', () => {
    expect(read('components/pmo/projects/MilestoneTable.vue')).toContain('items.value.find(m => m.id === deleteId.value)')
  })
  it('the edit page has no hand-built card', () => {
    const edit = read('pages/projects/[id]/milestones/[milestoneId]/edit.vue')
    expect(edit).toContain('<SharedFormSection panel')
    expect(edit).not.toContain('rounded-lg ring ring-default')
  })
})
