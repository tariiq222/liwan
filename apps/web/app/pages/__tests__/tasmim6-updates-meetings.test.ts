import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
const app = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(app, path), 'utf8')

describe('updates and meetings stay on the list template', () => {
  it('updates is a hide-header list page around a feed with no card of its own', () => {
    const page = read('pages/projects/[id]/updates.vue')
    for (const needle of ['<SharedListPage', 'hide-header', 'create-test-id="project-updates-create"']) expect(page).toContain(needle)
    expect(page).not.toContain('<SharedPageHeader')
    const feed = read('components/project/ProjectUpdateList.vue')
    for (const gone of ['<UCard :ui="{ body: \'p-0\' }">', '<USkeleton', 'showCreate']) expect(feed).not.toContain(gone)
  })
  it('meetings is a hide-header list page over a data table', () => {
    const page = read('pages/projects/[id]/meetings.vue')
    for (const needle of ['<SharedListPage', 'hide-header', '<SharedDataTable', '#mobile-row']) expect(page).toContain(needle)
    for (const gone of ['<UTable', 'md:hidden', 'overflow-x-auto']) expect(page).not.toContain(gone)
  })
})
