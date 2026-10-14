import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
const app = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(app, path), 'utf8')

describe('the task record is a record page', () => {
  it('the panel owns a record page with a back slot, an actions group and a properties aside', () => {
    const panel = read('components/task/TaskDetailPanel.vue')
    for (const needle of ['<SharedRecordPage', '#back', 'data-testid="task-detail-back"', 'data-testid="task-detail-menu"', '<TaskProperties']) expect(panel).toContain(needle)
    for (const gone of ['<USkeleton', 'nasq-page-width-detail', '<UCard']) expect(panel).not.toContain(gone)
    const page = read('components/task/TaskDetailPage.vue')
    expect(page).not.toContain('<SharedPageHeader')
    expect(page).not.toContain('<SharedPageContainer')
  })
  it('the property editors moved out of the tabs', () => {
    const props = read('components/task/TaskProperties.vue')
    for (const needle of ['<SharedPropertiesPanel', '<AssigneePicker', '<PrioritySelect', '<MilestoneSelect', '<TagPicker', 'validateTaskDates']) expect(props).toContain(needle)
    const details = read('components/task/TaskDetails.vue')
    for (const gone of ['<AssigneePicker', '<PrioritySelect', '<MilestoneSelect', '<TagPicker', 'useUpdateTask']) expect(details).not.toContain(gone)
  })
})
