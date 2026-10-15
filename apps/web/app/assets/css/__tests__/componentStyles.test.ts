import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Architecture guard: the final rollout keeps recipes in the shared sheets.
// Runtime canvas coordinates, chart sizes and tenant colour variables stay dynamic.
// The layer's own components are guarded by packages/ui/app/assets/css/__tests__/componentStyles.test.ts.
const app = resolve(import.meta.dirname, '../../..')
describe('component styles live in shared sheets', () => {
  it.each([
    'shared/data/DashboardChart.client.vue',
    'shared/form/DescriptionEditor.vue', 'pmo/tasks/Timeline.vue', 'hr/DepartmentOrgChart.vue',
    'hr/DepartmentTree.vue', 'hr/DocumentEditor.vue', 'meetings/MeetingMinutesDocument.vue',
  ])('%s has no private style block', path => {
    expect(readFileSync(resolve(app, 'components', path), 'utf8')).not.toMatch(/<style(?:\s|>)/)
  })
})
