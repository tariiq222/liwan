import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildTaskCreatePayload, parseTaskCreatePreset, plainTextToTaskHtml, taskCreatePresetQuery, validateTaskCreatePolicy } from '../taskCreatePolicy'

const taskFormSource = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../components/pmo/tasks/TaskCreateForm.vue'), 'utf8')
const projectTaskPageSource = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../pages/projects/[id]/tasks/new.vue'), 'utf8')

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

  it('keeps project quick creation explicit and leaves unsupported assignment fields out of the create contract', () => {
    expect(buildTaskCreatePayload({ name: 'Quick task', projectId: 7 })).not.toHaveProperty('user_ids')
    expect(buildTaskCreatePayload({ name: 'Quick task', projectId: 7 })).not.toHaveProperty('priority')
  })

})

describe('board column create presets', () => {
  it('accepts only the non-default open states and stages the board has', () => {
    expect(parseTaskCreatePreset({ preset_state: 'waiting', preset_stage: '12' }, 'project', [11, 12])).toEqual({ state: 'waiting', stage: { kind: 'project', id: 12 } })
    expect(parseTaskCreatePreset({ preset_state: 'approved' }, 'personal', [])).toEqual({ state: 'approved' })
    expect(parseTaskCreatePreset({ preset_state: ['changes_requested', 'done'] }, 'personal', [])).toEqual({ state: 'changes_requested' })
  })

  it('ignores everything else', () => {
    for (const query of [{ preset_state: 'done' }, { preset_state: 'cancelled' }, { preset_state: 'in_progress' }, { preset_state: 'bogus' }, { state: 'waiting' }, { preset_stage: '99' }, { preset_stage: '0' }, { preset_stage: '-1' }, { preset_stage: '1.5' }, { preset_stage: '12abc' }, { preset_stage: '' }]) {
      expect(parseTaskCreatePreset(query, 'personal', [11, 12])).toEqual({})
    }
  })

  it('builds the create query for a status or a stage column', () => {
    expect(taskCreatePresetQuery({ state: 'waiting' })).toEqual({ preset_state: 'waiting' })
    expect(taskCreatePresetQuery({ stageId: 12 })).toEqual({ preset_stage: '12' })
    expect(taskCreatePresetQuery({})).toEqual({})
  })
})

describe('board column add button wiring', () => {
  const boardSource = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../components/pmo/tasks/TaskBoard.vue'), 'utf8')

  it('renders a labelled round button only for columns that can take a new task', () => {
    expect(boardSource).toContain('data-testid="board-column-add"')
    expect(boardSource).toContain('i-lucide-plus')
    expect(boardSource).toContain("t('tasks.kanban.addToColumn')")
    expect(boardSource).toMatch(/lane\.state === 'done' \|\| lane\.state === 'cancelled'/)
  })

  it('applies the preset through the existing stage and transition endpoints', () => {
    expect(taskFormSource).toContain('applyPreset(created.id)')
    expect(taskFormSource).toContain("personal_stage_type_id: stage.id")
    expect(taskFormSource).toContain('transition({ id, state })')
  })
})
