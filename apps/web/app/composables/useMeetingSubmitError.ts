import { ApiError } from './useApi'

// Maps a failed meeting mutation to what the form shows: a 422 naming a server
// field renders next to that field (`fields` translates server names to form
// keys), any other 422 shows the server message, 403 shows the edit-forbidden
// notice, 409 asks the user to reload the meeting someone else changed, and everything else keeps the generic save message. Editing the form
// again resets the mutation, which clears the error.
export function useMeetingSubmitError<Key extends string>(options: {
  error: Ref<Error | null>
  reset: () => void
  edits: () => unknown
  fields: Record<string, Key>
}) {
  const { t } = useI18n()
  const apiError = computed(() => options.error.value instanceof ApiError ? options.error.value : null)
  const fieldErrors = computed(() => {
    const current = apiError.value
    const key = current?.status === 422 && current.field ? options.fields[current.field] : undefined
    return (key ? { [key]: current!.message } : {}) as Partial<Record<Key, string>>
  })
  const submitError = computed(() => {
    const current = apiError.value
    if (current?.status === 0) return current.message
    if (current?.status === 403) return t('meetingsUx.editForbidden')
    if (current?.status === 409) return t('meetingsUx.errors.conflict')
    if (current?.status === 422 && !Object.keys(fieldErrors.value).length) return current.message
    return t('meetingsUx.errors.save')
  })
  watch(options.edits, () => {
    if (options.error.value) options.reset()
  })
  return { fieldErrors, submitError }
}
