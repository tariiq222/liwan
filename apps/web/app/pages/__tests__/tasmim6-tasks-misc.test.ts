import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
const app = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(app, path), 'utf8')

describe('archived tasks stay on the list template', () => {
  it('the page is a list page over a data table with the restore action', () => {
    const page = read('components/pmo/tasks/TaskArchivedList.vue')
    for (const needle of ['<SharedListPage', ':back-to="backTo"', '<TaskArchivedTable', 'data-testid="archived-tasks-toolbar"']) expect(page).toContain(needle)
    for (const gone of ['<SharedPageHeader', '<UCard', '<ul class="divide-y', '<SharedDataTable']) expect(page).not.toContain(gone)
    // The same table is the «مؤرشفة» scope inside a project's task list card.
    const table = read('components/pmo/tasks/TaskArchivedTable.vue')
    for (const needle of ['<SharedDataTable', '#mobile-row', 'archived-tasks-count', 'taskLifecycle.restore']) expect(table).toContain(needle)
    expect(read('pages/projects/[id]/tasks.vue')).toContain('<TaskArchivedTable v-if="isArchived"')
  })
})
