import { computed, nextTick, ref, toValue, type MaybeRefOrGetter, type Ref } from 'vue'

/** Submit-time validation shared by meetings forms; the form owns all error text. */
export function useMeetingFormFeedback(errors: MaybeRefOrGetter<Record<string, string>>, form: Ref<HTMLFormElement | null>) {
  const attemptedSubmit = ref(false)
  const visibleErrors = computed<Record<string, string>>(() => attemptedSubmit.value ? toValue(errors) : {})
  function validate() {
    attemptedSubmit.value = true
    if (!Object.values(toValue(errors)).some(Boolean)) return true
    void nextTick(() => {
      form.value?.querySelector<HTMLElement>('[aria-invalid="true"], [data-invalid] input, [data-invalid] button, [data-invalid] textarea')?.focus()
    })
    return false
  }
  return { attemptedSubmit, visibleErrors, validate }
}
