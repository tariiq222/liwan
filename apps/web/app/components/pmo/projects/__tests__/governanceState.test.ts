import { describe, expect, it } from 'vitest'
import { RACI_ROLE_TONE, REGISTER_PRIORITY_TONE, REGISTER_STATUS_TONE, registerScoreTone } from '../governance/state'

describe('governance status tones', () => {
  it('keeps in-progress on the info tone used by tasks', () => {
    expect(REGISTER_STATUS_TONE.in_progress).toBe('info')
    expect(RACI_ROLE_TONE.R).toBe('info')
  })

  it('reads an open item as open within time and a normal priority as neutral', () => {
    expect(REGISTER_STATUS_TONE.open).toBe('info')
    expect(REGISTER_PRIORITY_TONE.normal).toBe('neutral')
  })

  it('grades register scores on the shared status scale', () => {
    expect(registerScoreTone(null)).toBe('neutral')
    expect(registerScoreTone(6)).toBe('info')
    expect(registerScoreTone(7)).toBe('warning')
    expect(registerScoreTone(12)).toBe('warning')
    expect(registerScoreTone(13)).toBe('destructive')
  })
})
