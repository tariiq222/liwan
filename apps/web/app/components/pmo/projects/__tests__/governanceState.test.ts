import { describe, expect, it } from 'vitest'
import { RACI_ROLE_TONE, REGISTER_STATUS_TONE, registerScoreTone } from '../governance/state'

describe('governance status tones', () => {
  it('keeps in-progress on the info tone used by tasks', () => {
    expect(REGISTER_STATUS_TONE.in_progress).toBe('info')
    expect(RACI_ROLE_TONE.R).toBe('info')
  })

  it('grades register scores on the shared status scale', () => {
    expect(registerScoreTone(null)).toBe('neutral')
    expect(registerScoreTone(8)).toBe('info')
    expect(registerScoreTone(9)).toBe('warning')
    expect(registerScoreTone(16)).toBe('destructive')
  })
})
