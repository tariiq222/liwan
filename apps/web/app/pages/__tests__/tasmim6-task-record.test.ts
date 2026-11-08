import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
const app = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(app, path), 'utf8')

describe('the task record is a record workspace', () => {
  it('the panel owns a workspace with the full trail, the status chip, the nav group, the ⋯ menu and a properties aside', () => {
    const panel = read('components/pmo/tasks/TaskDetailPanel.vue')
    for (const needle of ['<SharedRecordWorkspace', '#status', '#main', '#aside', 'data-testid="task-detail-nav"', 'data-testid="task-detail-menu"', "testId: 'task-detail-back'", '<TaskProperties', '<StateMenu']) expect(panel).toContain(needle)
    for (const gone of ['<SharedRecordPage', '#back', '<USkeleton', 'liwan-page-width-detail', '<UCard', 'tasks.detail.back', 'deadlineTagView', 'data-testid="task-archive"']) expect(panel).not.toContain(gone)
    const page = read('components/pmo/tasks/TaskDetailPage.vue')
    expect(page).not.toContain('<SharedPageHeader')
    expect(page).not.toContain('<SharedPageContainer')
  })
  it('the main column has no tabs and no cards', () => {
    const details = read('components/pmo/tasks/TaskDetails.vue')
    for (const gone of ['<UTabs', '<SharedRecordSection', 'sectionTabsUi']) expect(details).not.toContain(gone)
    for (const needle of ['<TaskDescription', '<SubtaskList', '<DependencyPicker', '<TaskAttachments', '<TaskActivity']) expect(details).toContain(needle)
  })
  it('the property editors read as text, and the personal stage left for the menu', () => {
    const props = read('components/pmo/tasks/TaskProperties.vue')
    for (const needle of ['<AssigneePicker', '<PrioritySelect', '<MilestoneSelect', '<TagPicker', '<SharedInlineText', 'validateTaskDates', 'plain']) expect(props).toContain(needle)
    for (const gone of ['<SharedPropertiesPanel', 'usePersonalStages', 'tasks.drawer.stage', '<USelect']) expect(props).not.toContain(gone)
    const details = read('components/pmo/tasks/TaskDetails.vue')
    for (const gone of ['<AssigneePicker', '<PrioritySelect', '<MilestoneSelect', '<TagPicker', 'useUpdateTask']) expect(details).not.toContain(gone)
  })
})
