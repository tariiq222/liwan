import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
const app = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(app, path), 'utf8')

describe('archived tasks stay on the list template', () => {
  it('the page is a list page over a data table with the restore action', () => {
    const page = read('components/pmo/tasks/TaskArchivedList.vue')
    for (const needle of ['<SharedListPage', ':back-to="backTo"', '<SharedDataTable', '#mobile-row', 'data-testid="archived-tasks-toolbar"']) expect(page).toContain(needle)
    for (const gone of ['<SharedPageHeader', '<UCard', '<ul class="divide-y']) expect(page).not.toContain(gone)
  })
})
