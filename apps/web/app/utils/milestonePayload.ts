import type { MilestonePatch } from '@nasq/contracts'

export function buildMilestonePatch(input: {
  name: string
  startDate: string | null
  deadline: string | null
  deliverables: Array<{ name: string; done: boolean }>
  originalStartDate?: string | null
  originalDeadline?: string | null
  isNew: boolean
}): MilestonePatch {
  const patch: MilestonePatch = { name: input.name, deliverables: input.deliverables }
  if (input.isNew || input.startDate !== (input.originalStartDate ?? null)) patch.start_date = input.startDate
  if (input.isNew || input.deadline !== (input.originalDeadline ?? null)) patch.deadline = input.deadline
  return patch
}

