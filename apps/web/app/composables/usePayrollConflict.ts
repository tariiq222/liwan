import { computed, ref } from 'vue'
import { isPayrollConflict } from '../utils/payrollErrors'

/**
 * The failure of a revision-checked payroll settings write and its explicit reload. A 409 keeps the user's draft and
 * blocks a second save until `reload` has fetched the latest row and `apply` has made it the form's new baseline.
 */
export function usePayrollConflict<T>(load: () => Promise<T>, apply: (fresh: T) => void) {
  const failure = ref<unknown>(null)
  const reloading = ref(false)
  const reloadFailure = ref<unknown>(null)
  const conflict = computed(() => isPayrollConflict(failure.value))
  async function reload() {
    if (reloading.value) return
    reloading.value = true
    reloadFailure.value = null
    try {
      apply(await load())
      failure.value = null
    } catch (error) { reloadFailure.value = error } finally { reloading.value = false }
  }
  return { failure, conflict, reloading, reloadFailure, reload }
}
