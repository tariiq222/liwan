import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// The pilot pages stay on their templates. This is a source guard, not a behaviour test: the behaviour
// is pinned by e2e/pilot-*.spec.ts.
const app = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(app, path), 'utf8')

describe('the pilot pages stay on their templates', () => {
  it.each([
    ['pages/projects/index.vue', ['<SharedListPage', 'create-test-id="project-new"']],
    ['pages/tasks.vue', ['<SharedListPage', ':views="views"']],
    ['pages/projects/[id]/tasks.vue', ['<SharedListPage', 'hide-header', 'create-test-id="project-header-create"']],
    ['pages/projects/[id]/index.vue', ['<SharedRecordPage', 'hide-header', '<SharedPropertiesPanel']],
    ['pages/projects/dashboard.vue', ['<SharedDashboardPage', '#filters']],
  ])('%s uses its template', (file, needles) => {
    const source = read(file)
    for (const needle of needles) expect(source, needle).toContain(needle)
    expect(source, 'no hand-made page header').not.toContain('<SharedPageHeader')
  })

  it.each(['components/project/ProjectTable.vue', 'components/task/TaskTable.vue'])('%s renders through SharedDataTable', (file) => {
    const source = read(file)
    expect(source).toContain('<SharedDataTable')
    expect(source).not.toContain('<UTable')
    expect(source).toContain('#mobile-row')
  })

  it('the dashboard charts are chart panels, with no scoped style and no hand-made card', () => {
    expect(read('components/project/dashboard/DashboardChartPanel.vue')).toContain('<ChartPanel')
    const charts = read('components/project/dashboard/ProjectDashboardCharts.vue')
    expect(charts).toContain('<SharedChartPanel')
    expect(charts).not.toContain('<UCard')
    expect(charts).not.toContain('<style')
  })

  it('the project overview has no scoped style and no container hack', () => {
    const source = read('components/project/ProjectOverview.vue')
    expect(source).not.toContain('<style')
    expect(source).not.toContain('nasq-page-width')
  })
})
