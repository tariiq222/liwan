import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
const app = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(app, path), 'utf8')

describe('the pilot leftovers use the shared pieces', () => {
  it('recent projects is a record section over a data table', () => {
    const source = read('components/pmo/projects/dashboard/ProjectDashboardRecentProjects.vue')
    for (const needle of ['<SharedRecordSection', 'id="project-dashboard-recent"', '<SharedDataTable', '#mobile-row']) expect(source).toContain(needle)
    for (const gone of ['useMediaQuery', '<UTable', '<UCard']) expect(source).not.toContain(gone)
  })
  it('the overview draws no skeleton of its own', () => {
    for (const file of ['components/pmo/projects/ProjectOverview.vue', 'components/pmo/projects/ProjectOverviewTasks.vue']) expect(read(file)).not.toContain('<USkeleton')
  })
})
