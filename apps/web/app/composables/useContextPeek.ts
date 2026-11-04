import type { Ref } from 'vue'

const OPEN_DELAY = 120
const CLOSE_DELAY = 200
/** How long a pointer heading into the open menu has to reach it before another rail item or the page takes over. */
const AIM_DELAY = 400

/** Which application's menu is open over the page. Touch never peeks: it keeps the folded card and its tap popover. */
export function useContextPeek(enabled: Readonly<Ref<boolean>>) {
  const peekId = ref<string | null>(null)
  /** The application whose menu the user kept open from a hover; the persistent sidebar shows it until the route changes or it folds. */
  const pinnedId = ref<string | null>(null)
  /** Viewport top of the rail item whose menu is open, so the menu opens level with it; null when it has no anchor. */
  const anchorTop = ref<number | null>(null)
  let timer: ReturnType<typeof setTimeout> | undefined
  function schedule(next: string | null, delay: number, top: number | null = null) {
    clearTimeout(timer)
    timer = setTimeout(() => {
      peekId.value = enabled.value ? next : null
      anchorTop.value = peekId.value ? top : null
    }, delay)
  }
  function keep() { clearTimeout(timer) }
  function close() {
    clearTimeout(timer)
    peekId.value = null
    anchorTop.value = null
  }
  watch(enabled, value => { if (!value) close() })
  /** Escape closes only the open menu: consumed at the capture phase so a record page's back handler never sees it. */
  function dismissOnEscape(event: Pick<KeyboardEvent, 'key' | 'preventDefault' | 'stopPropagation'>) {
    if (event.key !== 'Escape' || !peekId.value) return
    event.preventDefault()
    event.stopPropagation()
    close()
  }
  onBeforeUnmount(() => clearTimeout(timer))
  return {
    peekId,
    pinnedId,
    anchorTop,
    close,
    dismissOnEscape,
    /** Keeps the menu being previewed as the one the persistent sidebar shows. Call before the sidebar expands. */
    pin() { if (peekId.value) pinnedId.value = peekId.value },
    unpin() { pinnedId.value = null },
    keep,
    /**
     * Moving between rail items swaps the open menu at once; only the first opening waits. A pointer heading into the
     * open menu (`aiming`) defers the swap, and entering the menu (`keep`) cancels it. `top` anchors the menu.
     */
    peek(id: string, top: number | null = null, aiming = false) {
      schedule(id, !peekId.value ? OPEN_DELAY : aiming ? AIM_DELAY : 0, top)
    },
    /** Leaving a rail item toward the open menu (`aiming`) gives the pointer the aim delay to reach it. */
    release(aiming = false) { schedule(null, aiming ? AIM_DELAY : CLOSE_DELAY) },
  }
}
