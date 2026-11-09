import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { ASSISTANT_PANEL, NOTIFICATIONS_PANEL, slideOverId, useSlideOver } from '../useSlideOver'

const element = (connected = true) => ({ focus: vi.fn(), isConnected: connected }) as unknown as HTMLElement

describe('useSlideOver', () => {
  const state = new Map<string, ReturnType<typeof ref>>()
  beforeEach(() => {
    state.clear()
    vi.stubGlobal('useState', (key: string, init: () => unknown) => {
      if (!state.has(key)) state.set(key, ref(init()))
      return state.get(key)
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('keeps at most one panel open and switches directly from one to another', () => {
    const panel = useSlideOver()
    panel.show(NOTIFICATIONS_PANEL, element())
    expect(panel.open.value).toBe(NOTIFICATIONS_PANEL)
    panel.show('tasks', element())
    expect(panel.open.value).toBe('tasks')
  })

  it('toggles: a second press on the same button closes the panel, a press on another button switches', () => {
    const panel = useSlideOver()
    panel.toggle(ASSISTANT_PANEL, element())
    expect(panel.open.value).toBe(ASSISTANT_PANEL)
    panel.toggle('chat', element())
    expect(panel.open.value).toBe('chat')
    panel.toggle('chat', element())
    expect(panel.open.value).toBeNull()
  })

  it('returns focus to the button that opened the panel, but not after a page change or from a button that left', async () => {
    const panel = useSlideOver()
    const opener = element()
    panel.show('chat', opener)
    panel.close()
    await nextTick()
    expect(opener.focus).toHaveBeenCalledOnce()

    const moved = element()
    panel.show('chat', moved)
    panel.close({ restoreFocus: false })
    await nextTick()
    expect(moved.focus).not.toHaveBeenCalled()

    const gone = element(false)
    panel.show('chat', gone)
    panel.close()
    await nextTick()
    expect(gone.focus).not.toHaveBeenCalled()
  })

  it('does nothing when closing a closed panel', () => {
    const panel = useSlideOver()
    expect(() => panel.close()).not.toThrow()
    expect(panel.open.value).toBeNull()
  })

  it('names the DOM id after the panel, the target of the opening button', () => {
    expect(slideOverId('chat')).toBe('slide-over-chat')
  })
})
