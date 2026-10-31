import type { Ref } from 'vue'

const OPEN_DELAY = 120
const CLOSE_DELAY = 200

/** Which application's menu is open over the page. Touch never peeks: it keeps the folded card and its tap popover. */
export function useContextPeek(enabled: Readonly<Ref<boolean>>) {
  const peekId = ref<string | null>(null)
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
  onBeforeUnmount(() => clearTimeout(timer))
  return {
    peekId,
    close,
    keep,
    /** Moving between rail items swaps the open menu at once; only the first opening waits. */
    peek(id: string) { schedule(id, peekId.value ? 0 : OPEN_DELAY) },
    release() { schedule(null, CLOSE_DELAY) },
  }
}
