import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
const app = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(app, path), 'utf8')
describe('every 6a page is on its template', () => {
  it.each([
    ['pages/projects/[id]/milestones.vue', ['<SharedListPage', 'hide-header']],
    ['pages/projects/[id]/finance.vue', ['<SharedListPage', 'hide-header']],
    ['pages/projects/[id]/register.vue', ['<SharedListPage', 'hide-header']],
    ['pages/projects/[id]/stakeholders.vue', ['<SharedListPage', 'hide-header']],
    ['pages/projects/[id]/raci.vue', ['<SharedListPage', 'hide-header', '<RaciMatrix']],
    ['pages/projects/[id]/updates.vue', ['<SharedListPage', 'hide-header']],
    ['pages/projects/[id]/meetings.vue', ['<SharedListPage', 'hide-header', '<SharedDataTable']],
    ['pages/projects/[id]/schedule.vue', ['<SharedTimelineFrame', 'hide-header']],
    ['pages/projects/[id]/charter.vue', ['<SharedStandalonePage', 'variant="print"']],
    ['pages/projects/[id]/settings.vue', ['<SharedSettingsPage']],
    ['pages/projects/settings/catalogs/[resource]/index.vue', ['<SharedSettingsPage', '<SharedDataTable']],
    ['pages/projects/templates/index.vue', ['<SharedListPage', '<SharedDataTable']],
    ['pages/projects/templates/[id].vue', ['<SharedRecordPage']],
    ['pages/projects/[id]/finance/[entryId].vue', ['<SharedRecordPage']],
    ['pages/projects/[id]/register/[registerId].vue', ['<SharedRecordPage']],
    ['pages/projects/[id]/stakeholders/[stakeholderId].vue', ['<SharedRecordPage']],
    ['components/task/TaskDetailPanel.vue', ['<SharedRecordPage', '<TaskProperties']],
    ['pages/my-tasks/[id].vue', ['<SharedRecordPage']],
    ['pages/my-tasks/index.vue', ['<SharedListPage', '<SharedDataTable']],
    ['components/task/TaskArchivedList.vue', ['<SharedListPage', '<SharedDataTable']],
  ])('%s uses its template', (file, needles) => {
    const source = read(file)
    for (const needle of needles) expect(source, needle).toContain(needle)
    // The saved plan explicitly retains headers for settings/catalog and the charter read/edit branches.
    const headerOwners = ['pages/projects/[id]/charter.vue', 'pages/projects/[id]/settings.vue', 'pages/projects/settings/catalogs/[resource]/index.vue']
    if (headerOwners.includes(file)) expect(source.match(/<SharedPageHeader\b/g)).toHaveLength(file.endsWith('/charter.vue') ? 2 : 1)
    else expect(source, 'no hand-made page header').not.toContain('<SharedPageHeader')
  })
  it.each(['components/project/MilestoneTable.vue', 'components/project/finance/FinanceEntryTable.vue'])('%s renders through SharedDataTable', (file) => {
    const source = read(file)
    expect(source).toContain('<SharedDataTable')
    expect(source).not.toContain('<UTable')
  })
})
