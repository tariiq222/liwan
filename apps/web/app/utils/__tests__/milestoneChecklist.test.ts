import { describe, expect, it } from 'vitest'
import { claimMilestoneChecklistUpdate, releaseMilestoneChecklistUpdate } from '../milestoneChecklist'

describe('milestone checklist mutation guard', () => {
  it('rejects a rapid second toggle for the same milestone until the first completes', () => {
    const first = claimMilestoneChecklistUpdate(new Set(), 7)
    expect(first).not.toBeNull()
    expect(claimMilestoneChecklistUpdate(first!, 7)).toBeNull()
    expect(releaseMilestoneChecklistUpdate(first!, 7)).toEqual(new Set())
  })
})

