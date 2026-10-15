import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
const app = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(app, path), 'utf8')

describe('my tasks stays on the list template', () => {
  it('the list is a list page over a data table and keeps its test ids', () => {
    const page = read('pages/my-tasks/index.vue')
    for (const needle of ['<SharedListPage', 'create-test-id="my-tasks-new"', '<SharedDataTable', '#mobile-row', 'data-testid="my-tasks-tabs"', 'data-testid="my-tasks-toolbar"', 'liveListPath']) expect(page).toContain(needle)
    for (const gone of ['<SharedPageHeader', '<UCard', '<ul class="divide-y']) expect(page).not.toContain(gone)
  })
  it('the row component renders the five parts', () => {
    const row = read('components/personal-tasks/MyTaskRow.vue')
    for (const part of ["'name'", "'state'", "'deadline'", "'assignees'", "'card'"]) expect(row).toContain(part)
    expect(row).not.toContain('<li')
  })
})
