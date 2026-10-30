import { describe, expect, it } from 'vitest'
import { isMilestoneOverdue, milestoneBadge } from '../milestoneState'

describe('milestone state badge', () => {
  it('reads a reached milestone as success whatever its deadline', () => {
    expect(milestoneBadge({ is_reached: true, deadline: '2001-01-01' })).toEqual({ tone: 'success', labelKey: 'projects.milestones.reached' })
  })

  it('reads an open milestone within time as info and upcoming', () => {
    expect(milestoneBadge({ is_reached: false, deadline: '2999-01-01' })).toEqual({ tone: 'info', labelKey: 'projects.milestones.upcoming' })
    expect(milestoneBadge({ is_reached: false, deadline: null })).toEqual({ tone: 'info', labelKey: 'projects.milestones.upcoming' })
  })

  it('reads an open milestone past its deadline as destructive and overdue', () => {
    expect(milestoneBadge({ is_reached: false, deadline: '2001-01-01' })).toEqual({ tone: 'destructive', labelKey: 'projects.milestones.overdue' })
    expect(isMilestoneOverdue({ is_reached: true, deadline: '2001-01-01' })).toBe(false)
  })
})
