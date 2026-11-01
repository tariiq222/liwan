import type { Ref } from 'vue'

const OPEN_DELAY = 120
const CLOSE_DELAY = 200

/** Which application's menu is open over the page. Touch never peeks: it keeps the folded card and its tap popover. */
export function useContextPeek(enabled: Readonly<Ref<boolean>>) {
  const peekId = ref<string | null>(null)
  /** The application whose menu the user kept open from a hover; the persistent sidebar shows it until the route changes or it folds. */
  const pinnedId = ref<string | null>(null)
  let timer: ReturnType<typeof setTimeout> | undefined
  function schedule(next: string | null, delay: number) {
    clearTimeout(timer)
    timer = setTimeout(() => { peekId.value = enabled.value ? next : null }, delay)
  }
  function keep() { clearTimeout(timer) }
  function close() {
    clearTimeout(timer)
    peekId.value = null
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
    close,
    dismissOnEscape,
    /** Keeps the menu being previewed as the one the persistent sidebar shows. Call before the sidebar expands. */
    pin() { if (peekId.value) pinnedId.value = peekId.value },
    unpin() { pinnedId.value = null },
    keep,
    /** Moving between rail items swaps the open menu at once; only the first opening waits. */
    peek(id: string) { schedule(id, peekId.value ? 0 : OPEN_DELAY) },
    release() { schedule(null, CLOSE_DELAY) },
  }
}
