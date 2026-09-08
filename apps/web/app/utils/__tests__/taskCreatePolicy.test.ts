import { describe, expect, it } from 'vitest'
import { buildTaskCreatePayload, plainTextToTaskHtml, validateTaskCreatePolicy } from '../taskCreatePolicy'

describe('guided task creation policy', () => {
  const base = {
    guided: true,
    canManage: true,
    projectReady: true,
    projectLoading: false,
    milestonesLoading: false,
    milestonesFailed: false,
    hasDatedMilestones: true,
    selectedMilestone: true,
    plannedStart: '2030-02-01',
    dateDeadline: '2030-02-28T23:59:00Z',
  }

  it('requires a selected milestone and a complete date pair for dated projects', () => {
    expect(validateTaskCreatePolicy({ ...base, selectedMilestone: false })).toBe('tasks.milestoneRequired')
    expect(validateTaskCreatePolicy({ ...base, dateDeadline: null })).toBe('tasks.scheduleRequired')
    expect(validateTaskCreatePolicy({ ...base, plannedStart: null })).toBe('tasks.scheduleRequired')
  })

  it('keeps personal, nonmanager, and legacy undated creation compatible', () => {
    expect(validateTaskCreatePolicy({ ...base, guided: false, selectedMilestone: false, plannedStart: null, dateDeadline: null })).toBeNull()
    expect(validateTaskCreatePolicy({ ...base, canManage: false, selectedMilestone: false, plannedStart: null, dateDeadline: null })).toBeNull()
    expect(validateTaskCreatePolicy({ ...base, hasDatedMilestones: false, selectedMilestone: false, plannedStart: null, dateDeadline: null })).toBeNull()
  })

  it('blocks guided manager submission while project or milestones are unavailable', () => {
    expect(validateTaskCreatePolicy({ ...base, projectReady: false })).toBe('tasks.projectUnavailable')
    expect(validateTaskCreatePolicy({ ...base, milestonesLoading: true })).toBe('tasks.milestonesLoading')
    expect(validateTaskCreatePolicy({ ...base, milestonesFailed: true })).toBe('tasks.milestonesLoadError')
  })

  it('omits unset fields from the API body', () => {
    expect(buildTaskCreatePayload({ name: 'Legacy', projectId: 7 })).toEqual({ name: 'Legacy', project_id: 7 })
    expect(buildTaskCreatePayload({ name: 'Planned', projectId: 7, milestoneId: 3, plannedStart: '2030-02-01', dateDeadline: '2030-02-28T23:59:00Z' })).toEqual({
      name: 'Planned', project_id: 7, milestone_id: 3, planned_start: '2030-02-01', date_deadline: '2030-02-28T23:59:00Z',
    })
  })

  it('escapes plain descriptions and preserves line breaks', () => {
    expect(plainTextToTaskHtml('<script>alert("x")</script>\nDone & signed')).toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;<br>Done &amp; signed')
  })

  it('includes optional description and named outputs without changing schedule fields', () => {
    expect(buildTaskCreatePayload({
      name: 'Content task', projectId: 7, description: 'Safe body',
      deliverables: [{ name: '  Runbook  ', done: false }, { name: '  ', done: true }],
    })).toEqual({
      name: 'Content task', project_id: 7, description: 'Safe body',
      deliverables: [{ name: 'Runbook', done: false }],
    })
  })
})
