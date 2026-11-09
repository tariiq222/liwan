import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
const app = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(app, path), 'utf8')

describe('updates live in the summary and meetings stay on the list template', () => {
  it('the updates page is gone: the summary posts the latest and lists the earlier ones', () => {
    const route = read('pages/projects/[id]/updates.vue')
    expect(route).not.toContain('<SharedListPage')
    expect(route).toContain('<NuxtPage')
    const summary = read('components/pmo/projects/ProjectOverview.vue')
    for (const needle of ['data-testid="project-updates-create"', 'data-testid="project-overview-latest-update"', '<ProjectUpdateList']) expect(summary).toContain(needle)
    const feed = read('components/pmo/projects/ProjectUpdateList.vue')
    expect(feed).toContain('.slice(1)')
    for (const gone of ['<UCard :ui="{ body: \'p-0\' }">', '<USkeleton', 'showCreate', 'canManage']) expect(feed).not.toContain(gone)
  })
  it('meetings is a hide-header list page over a data table', () => {
    const page = read('pages/projects/[id]/meetings.vue')
    for (const needle of ['<SharedListPage', 'hide-header', '<SharedDataTable', '#mobile-row']) expect(page).toContain(needle)
    for (const gone of ['<UTable', 'md:hidden', 'overflow-x-auto']) expect(page).not.toContain(gone)
  })
})
