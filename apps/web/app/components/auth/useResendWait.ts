import { computed, ref, type Ref } from 'vue'
import { useNow } from '@vueuse/core'
import { secondsLeft } from './loginFlow'

/** The clock the countdown reads. `useNow` re-evaluates every 250ms, so a tab that was suspended catches up on
 * its next tick instead of arriving with time still on the clock; the wait is held as a deadline, never as a
 * number that each tick decrements. */
export type WaitClock = Ref<Date>

/**
 * The live countdown of a resend wait. `start(seconds)` begins a wait of the server's own length, `seconds` reads
 * the whole seconds left (0 when a resend may go out), and `waiting` is true while it is still counting.
 */
export function useResendWait(clock: WaitClock = useNow({ interval: 250 })) {
  const deadline = ref(0)
  // The clock only ticks every 250ms, so right after `start` it can still read an earlier time than the deadline was
  // measured from; counting from that stale reading would show one second too many. The wait never starts before itself.
  const startedAt = ref(0)
  const seconds = computed(() => secondsLeft(deadline.value, Math.max(clock.value.getTime(), startedAt.value)))
  const waiting = computed(() => seconds.value > 0)
  function start(after: number) {
    startedAt.value = Date.now()
    deadline.value = after > 0 ? startedAt.value + after * 1000 : 0
  }
  function stop() { deadline.value = 0 }
  return { seconds, waiting, deadline, start, stop }
}
