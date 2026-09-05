import { describe, expect, it } from 'vitest'
import { permittedNextStates } from '../taskState'

describe('independent task approval capability', () => {
  it('offers no transitions to readers', () => {
    expect(permittedNextStates('in_progress', false, false)).toEqual([])
  })
  it('lets an approver approve or request changes without editing the task', () => {
    expect(permittedNextStates('in_progress', false, true)).toEqual(['changes_requested', 'approved'])
  })
  it('keeps approval transitions away from an ordinary editor', () => {
    expect(permittedNextStates('in_progress', true, false)).toEqual(['waiting', 'done', 'cancelled'])
  })
})
