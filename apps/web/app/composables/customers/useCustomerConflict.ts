import { ref, shallowRef } from 'vue'
import type { CustomerCandidate, CustomerLink } from '@liwan/contracts'
import { customerConflictCandidates } from './customerErrors'

/**
 * The step a link, a win or a sold call stops at when customers share the record's phone. `offer` takes the refusal
 * of an attempt: when it is the 409 conflict with candidates it keeps them and the way to repeat the same attempt,
 * and `choose` repeats it with the user's answer (an existing customer or a new one). Nothing is linked until then,
 * and the server never merges on its own.
 */
export function useCustomerConflict() {
  const candidates = ref<CustomerCandidate[] | null>(null)
  const repeat = shallowRef<((choice: CustomerLink) => Promise<unknown>) | null>(null)

  function clear() {
    candidates.value = null
    repeat.value = null
  }

  /** True when `error` was the conflict: the candidates are then shown and the error needs no message of its own. */
  function offer(error: unknown, again: (choice: CustomerLink) => Promise<unknown>): boolean {
    const found = customerConflictCandidates(error)
    if (!found) return false
    candidates.value = found
    repeat.value = again
    return true
  }

  async function choose(choice: CustomerLink) {
    const again = repeat.value
    if (!again) return undefined
    clear()
    return again(choice)
  }

  return { candidates, offer, choose, clear }
}
