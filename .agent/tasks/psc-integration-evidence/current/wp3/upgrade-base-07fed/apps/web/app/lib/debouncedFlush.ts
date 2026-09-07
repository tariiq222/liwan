// Pure, framework-agnostic debounced buffer used by DescriptionEditor.vue.
// `schedule(value)` remembers the latest value and (re)arms a `delayMs`
// timer; `flush()` cancels any pending timer and, only if a value is
// actually pending, emits it immediately and clears the buffer — a `flush()`
// with nothing pending (already flushed, or never scheduled) is a no-op, so
// callers can call it unconditionally on unmount/task-change without a
// wasted emit. Extracted as a plain function (no Vue/Nuxt) so its timing and
// no-double-emit behaviour can be unit tested without booting Nuxt — see
// __tests__/debouncedFlush.test.ts.
export function createDebouncedFlush<T>(delayMs: number, onFlush: (value: T) => void) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: { value: T } | undefined

  function flush() {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
    if (pending) {
      const { value } = pending
      pending = undefined
      onFlush(value)
    }
  }

  function schedule(value: T) {
    pending = { value }
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(flush, delayMs)
  }

  function cancel() {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
    pending = undefined
  }

  return { schedule, flush, cancel }
}
