import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDebouncedFlush } from '../debouncedFlush'

describe('createDebouncedFlush', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('emits once after the delay elapses', () => {
    const onFlush = vi.fn()
    const buffer = createDebouncedFlush<string>(800, onFlush)

    buffer.schedule('a')
    vi.advanceTimersByTime(799)
    expect(onFlush).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onFlush).toHaveBeenCalledExactlyOnceWith('a')
  })

  it('re-arms the timer on every schedule, only emitting the latest value', () => {
    const onFlush = vi.fn()
    const buffer = createDebouncedFlush<string>(800, onFlush)

    buffer.schedule('a')
    vi.advanceTimersByTime(500)
    buffer.schedule('b')
    vi.advanceTimersByTime(500)
    expect(onFlush).not.toHaveBeenCalled()
    vi.advanceTimersByTime(300)
    expect(onFlush).toHaveBeenCalledExactlyOnceWith('b')
  })

  // This is the data-loss scenario from the code review: a component is
  // reused across a navigation (e.g. Vue Router swapping /tasks/A for
  // /tasks/B without remounting) with a pending debounced edit in flight.
  // flush() must emit the pending value synchronously instead of letting
  // the original timer fire later against whatever is current by then.
  it('flush() emits the pending value immediately and cancels the timer', () => {
    const onFlush = vi.fn()
    const buffer = createDebouncedFlush<string>(800, onFlush)

    buffer.schedule('typed-into-task-a')
    vi.advanceTimersByTime(200) // well within the debounce window
    buffer.flush()
    expect(onFlush).toHaveBeenCalledExactlyOnceWith('typed-into-task-a')

    // the original timer must not fire a second time later
    vi.advanceTimersByTime(1000)
    expect(onFlush).toHaveBeenCalledOnce()
  })

  it('flush() is a no-op when nothing is pending', () => {
    const onFlush = vi.fn()
    const buffer = createDebouncedFlush<string>(800, onFlush)

    buffer.flush()
    expect(onFlush).not.toHaveBeenCalled()

    buffer.schedule('x')
    buffer.flush()
    onFlush.mockClear()
    buffer.flush()
    expect(onFlush).not.toHaveBeenCalled()
  })

  it('cancel() drops the pending value without emitting', () => {
    const onFlush = vi.fn()
    const buffer = createDebouncedFlush<string>(800, onFlush)

    buffer.schedule('a')
    buffer.cancel()
    vi.advanceTimersByTime(1000)
    expect(onFlush).not.toHaveBeenCalled()

    buffer.flush()
    expect(onFlush).not.toHaveBeenCalled()
  })
})
