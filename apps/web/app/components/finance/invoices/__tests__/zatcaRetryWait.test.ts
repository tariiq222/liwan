import { describe, expect, it } from 'vitest'
import { zatcaRetryWaitSeconds } from '../zatcaRetryWait'

const AT = Date.parse('2026-09-11T08:05:00Z')

describe('ZATCA retry wait', () => {
  it('counts the seconds left until the server allows the retry', () => {
    expect(zatcaRetryWaitSeconds({ next_retry_at: '2026-09-11T08:05:00Z' }, AT - 90_000)).toBe(90)
    expect(zatcaRetryWaitSeconds({ next_retry_at: '2026-09-11T08:05:00Z' }, AT - 500)).toBe(1)
  })

  it('is zero once the time has come, before any manual send and for a final document', () => {
    expect(zatcaRetryWaitSeconds({ next_retry_at: '2026-09-11T08:05:00Z' }, AT)).toBe(0)
    expect(zatcaRetryWaitSeconds({ next_retry_at: '2026-09-11T08:05:00Z' }, AT + 60_000)).toBe(0)
    expect(zatcaRetryWaitSeconds({ next_retry_at: null }, AT)).toBe(0)
  })
})
