import type { TaskCreate, TaskState } from '@liwan/contracts'

export type TaskDeliverable = { name: string; done: boolean }

export type TaskCreatePayload = TaskCreate

export type TaskCreatePolicyInput = {
  guided: boolean
  canManage: boolean
  projectReady: boolean
  projectLoading: boolean
  milestonesLoading: boolean
  milestonesFailed: boolean
  hasDatedMilestones: boolean
  selectedMilestone: boolean
  plannedStart: string | null
  dateDeadline: string | null
}

/** Validate the additional requirements of guided, manager-owned task creation. */
export function validateTaskCreatePolicy(input: TaskCreatePolicyInput): string | null {
  if (!input.guided || !input.canManage) return null
  if (!input.projectReady || input.projectLoading) return 'tasks.projectUnavailable'
  if (input.milestonesLoading) return 'tasks.milestonesLoading'
  if (input.milestonesFailed) return 'tasks.milestonesLoadError'
  if (!input.hasDatedMilestones) return null
  if (!input.selectedMilestone) return 'tasks.milestoneRequired'
  if (!input.plannedStart || !input.dateDeadline) return 'tasks.scheduleRequired'
  return null
}

/** Omit unset optional schedule fields so legacy/personal task creation stays unchanged. */
export function buildTaskCreatePayload(input: {
  name: string
  projectId: number
  milestoneId?: number
  plannedStart?: string
  dateDeadline?: string
  description?: string
  deliverables?: readonly TaskDeliverable[]
}): TaskCreatePayload {
  const body: TaskCreatePayload = { name: input.name, project_id: input.projectId }
  if (input.milestoneId !== undefined) body.milestone_id = input.milestoneId
  if (input.plannedStart) body.planned_start = input.plannedStart
  if (input.dateDeadline) body.date_deadline = input.dateDeadline
  if (input.description) body.description = input.description
  const deliverables = input.deliverables
    ?.map(item => ({ name: item.name.trim(), done: item.done }))
    .filter(item => item.name)
  if (deliverables?.length) body.deliverables = deliverables
  return body
}

/** Encode plain textarea text as safe HTML while retaining user line breaks. */
export function plainTextToTaskHtml(value: string): string {
  const escaped = value.replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character)
  return escaped.replace(/\r\n|\r|\n/g, '<br>')
}

export type TaskCreatePreset = { state?: TaskState; stage?: { kind: 'personal' | 'project'; id: number } }

// The board's column '+' opens the create route with `preset_state` / `preset_stage` (not `state`, which the
// project task list already uses as its filter). A new task starts in progress, so only the other open states
// are presets; done and cancelled columns have no '+'.
export const CREATE_PRESET_STATES: readonly TaskState[] = ['waiting', 'changes_requested', 'approved']

/** The valid presets in a create route's query: anything else, including a stage the board does not have, is ignored. */
export function parseTaskCreatePreset(query: Record<string, unknown>, kind: 'personal' | 'project', stageIds: readonly number[]): TaskCreatePreset {
  const preset: TaskCreatePreset = {}
  const state = Array.isArray(query.preset_state) ? query.preset_state[0] : query.preset_state
  if (CREATE_PRESET_STATES.includes(state as TaskState)) preset.state = state as TaskState
  const raw = Array.isArray(query.preset_stage) ? query.preset_stage[0] : query.preset_stage
  const id = typeof raw === 'string' && /^[1-9]\d*$/.test(raw) ? Number(raw) : null
  if (id !== null && stageIds.includes(id)) preset.stage = { kind, id }
  return preset
}

/** The create route's query for a board column: `preset_state` for a status column, `preset_stage` for a stage column. */
export function taskCreatePresetQuery(column: { state?: TaskState; stageId?: number }): { preset_state?: string; preset_stage?: string } {
  return {
    ...(column.state ? { preset_state: column.state } : {}),
    ...(column.stageId ? { preset_stage: String(column.stageId) } : {}),
  }
}
