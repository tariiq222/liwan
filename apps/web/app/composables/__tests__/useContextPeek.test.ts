import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onBeforeUnmount, ref, watch } from 'vue'

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('watch', watch)
  vi.stubGlobal('onBeforeUnmount', onBeforeUnmount)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const escapeEvent = (key = 'Escape') => ({ key, preventDefault: vi.fn(), stopPropagation: vi.fn() })

async function open(id = 'meetings') {
  const { useContextPeek } = await import('../useContextPeek')
  const enabled = ref(true)
  const peek = useContextPeek(enabled)
  peek.peek(id)
  vi.advanceTimersByTime(120)
  return { enabled, ...peek }
}

describe('useContextPeek', () => {
  it('opens the hovered application after the open delay', async () => {
    const { peekId } = await open()
    expect(peekId.value).toBe('meetings')
  })

  it('Escape closes the open menu and consumes the event', async () => {
    const { peekId, dismissOnEscape } = await open()
    const event = escapeEvent()
    dismissOnEscape(event)
    expect(peekId.value).toBeNull()
    expect(event.preventDefault).toHaveBeenCalled()
    expect(event.stopPropagation).toHaveBeenCalled()
  })

  it('leaves Escape alone when no menu is open or another key is pressed', async () => {
    const { useContextPeek } = await import('../useContextPeek')
    const idle = useContextPeek(ref(true))
    const closed = escapeEvent()
    idle.dismissOnEscape(closed)
    expect(closed.stopPropagation).not.toHaveBeenCalled()

    const { peekId, dismissOnEscape } = await open()
    const other = escapeEvent('a')
    dismissOnEscape(other)
    expect(other.stopPropagation).not.toHaveBeenCalled()
    expect(peekId.value).toBe('meetings')
  })

  it('pin keeps the previewed application after the peek ends', async () => {
    const { peekId, pinnedId, pin, close, unpin } = await open('meetings')
    pin()
    close()
    expect(peekId.value).toBeNull()
    expect(pinnedId.value).toBe('meetings')
    unpin()
    expect(pinnedId.value).toBeNull()
  })

  it('pin without an open menu keeps nothing', async () => {
    const { useContextPeek } = await import('../useContextPeek')
    const idle = useContextPeek(ref(true))
    idle.pin()
    expect(idle.pinnedId.value).toBeNull()
  })
})
