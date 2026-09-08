/** Claim one milestone checklist mutation at a time to prevent lost toggles. */
export function claimMilestoneChecklistUpdate(pending: ReadonlySet<number>, milestoneId: number): Set<number> | null {
  if (pending.has(milestoneId)) return null
  return new Set(pending).add(milestoneId)
}

export function releaseMilestoneChecklistUpdate(pending: ReadonlySet<number>, milestoneId: number): Set<number> {
  const next = new Set(pending)
  next.delete(milestoneId)
  return next
}

