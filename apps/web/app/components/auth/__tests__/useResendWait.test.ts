import { ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useResendWait } from '../useResendWait'

const at = (iso: string) => new Date(iso)

// The countdown reads a clock and a deadline; it never decrements a stored number, so a tab that was suspended
// arrives at the truth on its next tick instead of waking up with time still on the clock.
describe('the resend wait', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(at('2026-01-01T00:00:00Z')) })
  afterEach(() => { vi.useRealTimers() })

  it('counts the server wait down and reaches zero exactly at the deadline', () => {
    const clock = ref(at('2026-01-01T00:00:00Z'))
    const wait = useResendWait(clock)
    wait.start(60)
    expect(wait.seconds.value).toBe(60)
    expect(wait.waiting.value).toBe(true)

    clock.value = at('2026-01-01T00:00:30Z')
    expect(wait.seconds.value).toBe(30)

    clock.value = at('2026-01-01T00:00:59Z')
    expect(wait.seconds.value).toBe(1)
    expect(wait.waiting.value).toBe(true)

    clock.value = at('2026-01-01T00:01:00Z')
    expect(wait.seconds.value).toBe(0)
    expect(wait.waiting.value).toBe(false)
  })

  it('starts at the server wait even when the clock last ticked before the start', () => {
    const clock = ref(at('2026-01-01T00:00:00Z'))
    const wait = useResendWait(clock)
    vi.setSystemTime(at('2026-01-01T00:00:00.100Z'))
    wait.start(60)
    expect(wait.seconds.value).toBe(60)
  })

  it('catches up after a suspended tab instead of drifting with each tick', () => {
    const clock = ref(at('2026-01-01T00:00:00Z'))
    const wait = useResendWait(clock)
    wait.start(60)
    clock.value = at('2026-01-01T00:01:30Z')
    expect(wait.seconds.value).toBe(0)
  })

  it('waits nothing when the server asks for no wait, and a stop clears the wait', () => {
    const clock = ref(at('2026-01-01T00:00:00Z'))
    const wait = useResendWait(clock)
    wait.start(0)
    expect(wait.waiting.value).toBe(false)
    expect(wait.deadline.value).toBe(0)
    wait.start(10)
    expect(wait.waiting.value).toBe(true)
    wait.stop()
    expect(wait.seconds.value).toBe(0)
    expect(wait.waiting.value).toBe(false)
  })
})
