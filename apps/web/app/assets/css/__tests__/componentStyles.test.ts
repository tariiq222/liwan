import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Architecture guard: the final rollout keeps recipes in the shared sheets.
// Runtime canvas coordinates, chart sizes and tenant colour variables stay dynamic.
const app = resolve(import.meta.dirname, '../../..')
describe('component styles live in shared sheets', () => {
  it.each([
    'shared/SettingsPage.vue', 'shared/DashboardChart.client.vue', 'shared/RichText.vue',
    'shared/DescriptionEditor.vue', 'task/Timeline.vue', 'hr/DepartmentOrgChart.vue',
    'hr/DepartmentTree.vue', 'hr/DocumentEditor.vue', 'meetings/MeetingMinutesDocument.vue',
  ])('%s has no private style block', path => {
    expect(readFileSync(resolve(app, 'components', path), 'utf8')).not.toMatch(/<style(?:\s|>)/)
  })
})
