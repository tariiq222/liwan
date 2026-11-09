import { nextTick } from 'vue'

/** The foundation's own panel; an application's panel uses the id of its manifest `quickPanel`, the assistant its own. */
export const NOTIFICATIONS_PANEL = 'notifications'
export const ASSISTANT_PANEL = 'assistant'

/** The DOM id of a panel: the opening button's `aria-controls` points at it. */
export const slideOverId = (panel: string) => `slide-over-${panel}`

// The element that opened the panel gets focus back when it closes. Client only; the server never opens a panel.
let opener: HTMLElement | null = null

function currentFocus(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  const active = document.activeElement
  return active instanceof HTMLElement && active !== document.body ? active : null
}

/**
 * The top bar's one slide-over state: which panel is open (at most one), with the open, close and toggle actions.
 * Closing returns focus to the button that opened the panel, except when the page itself changed.
 */
export function useSlideOver() {
  const open = useState<string | null>('slide-over', () => null)

  function show(id: string, from?: HTMLElement | null) {
    opener = from ?? currentFocus()
    open.value = id
  }

  function close({ restoreFocus = true }: { restoreFocus?: boolean } = {}) {
    if (open.value === null) return
    open.value = null
    const target = opener
    opener = null
    if (restoreFocus && target?.isConnected) void nextTick(() => target.focus())
  }

  function toggle(id: string, from?: HTMLElement | null) {
    if (open.value === id) close()
    else show(id, from)
  }

  return { open, show, close, toggle }
}
