import type { TaskCreate } from '@nasq/contracts'

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
