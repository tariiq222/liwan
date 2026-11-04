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

  it('keeps the anchor of the open menu and follows a swap to another rail item', async () => {
    const { useContextPeek } = await import('../useContextPeek')
    const peek = useContextPeek(ref(true))
    peek.peek('crm', 610)
    expect(peek.anchorTop.value).toBeNull()
    vi.advanceTimersByTime(120)
    expect(peek.anchorTop.value).toBe(610)
    peek.peek('inbox', 667)
    vi.advanceTimersByTime(0)
    expect(peek.peekId.value).toBe('inbox')
    expect(peek.anchorTop.value).toBe(667)
  })

  it('drops the anchor when the menu closes', async () => {
    const { useContextPeek } = await import('../useContextPeek')
    const peek = useContextPeek(ref(true))
    peek.peek('crm', 610)
    vi.advanceTimersByTime(120)
    peek.release()
    vi.advanceTimersByTime(200)
    expect(peek.peekId.value).toBeNull()
    expect(peek.anchorTop.value).toBeNull()
    peek.peek('crm', 610)
    vi.advanceTimersByTime(120)
    peek.close()
    expect(peek.anchorTop.value).toBeNull()
  })

  it('a rail item crossed while aiming at the open menu waits, and entering the menu cancels it', async () => {
    const { useContextPeek } = await import('../useContextPeek')
    const peek = useContextPeek(ref(true))
    peek.peek('finance', 449)
    vi.advanceTimersByTime(120)
    peek.release()
    peek.peek('ai', 506, true)
    vi.advanceTimersByTime(399)
    expect(peek.peekId.value).toBe('finance')
    peek.release()
    peek.keep()
    vi.advanceTimersByTime(500)
    expect(peek.peekId.value).toBe('finance')
    expect(peek.anchorTop.value).toBe(449)
  })

  it('resting on the crossed rail item swaps after the aim delay', async () => {
    const { useContextPeek } = await import('../useContextPeek')
    const peek = useContextPeek(ref(true))
    peek.peek('finance', 449)
    vi.advanceTimersByTime(120)
    peek.peek('hr', 392, true)
    vi.advanceTimersByTime(400)
    expect(peek.peekId.value).toBe('hr')
    expect(peek.anchorTop.value).toBe(392)
  })

  it('leaving the rail toward the open menu keeps it for the aim delay', async () => {
    const { useContextPeek } = await import('../useContextPeek')
    const peek = useContextPeek(ref(true))
    peek.peek('finance', 449)
    vi.advanceTimersByTime(120)
    peek.release(true)
    vi.advanceTimersByTime(399)
    expect(peek.peekId.value).toBe('finance')
    vi.advanceTimersByTime(1)
    expect(peek.peekId.value).toBeNull()
  })
})
