import { describe, expect, it } from 'vitest'
import { PROJECT_CHANGE_STATES } from '@liwan/contracts'
import { CHANGE_STATE_TONE, CHANGE_TERMINAL_STATES } from '../state'

describe('change request state presentation', () => {
  it('gives every state a tone and nothing else', () => {
    expect(Object.keys(CHANGE_STATE_TONE).sort()).toEqual([...PROJECT_CHANGE_STATES].sort())
  })

  it('marks a decision as success or destructive and an undecided request as neutral or info', () => {
    expect(CHANGE_STATE_TONE.approved).toBe('success')
    expect(CHANGE_STATE_TONE.rejected).toBe('destructive')
    expect(CHANGE_STATE_TONE.submitted).toBe('info')
    expect(CHANGE_STATE_TONE.draft).toBe('neutral')
  })

  it('lists the states that never move again', () => {
    expect([...CHANGE_TERMINAL_STATES].sort()).toEqual(['implemented', 'rejected', 'withdrawn'])
  })
})
