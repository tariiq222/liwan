export type MilestoneDateInput = {
  projectStart?: string | null
  projectEnd?: string | null
  startDate?: string | null
  deadline?: string | null
}

export type TaskDateInput = {
  milestoneStart?: string | null
  milestoneDeadline?: string | null
  plannedStart?: string | null
  dateDeadline?: string | null
}

function day(value: string | null | undefined): string | null {
  if (!value) return null
  const match = /^\d{4}-\d{2}-\d{2}/.exec(value)
  return match?.[0] ?? null
}

/** Return the API error key for a milestone date violation, or null when valid. */
export function validateMilestoneDates(input: MilestoneDateInput): string | null {
  const start = day(input.startDate)
  const deadline = day(input.deadline)
  const projectStart = day(input.projectStart)
  const projectEnd = day(input.projectEnd)
  if (start && deadline && start > deadline) return 'milestone.startAfterDeadline'
  if (start && projectStart && start < projectStart) return 'milestone.startOutsideProject'
  if (deadline && projectEnd && deadline > projectEnd) return 'milestone.deadlineOutsideProject'
  if (deadline && projectStart && deadline < projectStart) return 'milestone.deadlineOutsideProject'
  if (start && projectEnd && start > projectEnd) return 'milestone.startOutsideProject'
  return null
}

/** Return the API error key for a task schedule violation, or null when valid. */
export function validateTaskDates(input: TaskDateInput): string | null {
  const start = day(input.plannedStart)
  const deadline = day(input.dateDeadline)
  const milestoneStart = day(input.milestoneStart)
  const milestoneDeadline = day(input.milestoneDeadline)
  if (start && deadline && start > deadline) return 'task.startAfterDeadline'
  if (start && milestoneStart && start < milestoneStart) return 'task.startOutsideMilestone'
  if (deadline && milestoneDeadline && deadline > milestoneDeadline) return 'task.deadlineOutsideMilestone'
  if (deadline && milestoneStart && deadline < milestoneStart) return 'task.deadlineOutsideMilestone'
  return null
}

