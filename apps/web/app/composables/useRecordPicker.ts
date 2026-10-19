import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { recordPickerFor } from '../modules/surfaces'
import { useAccess } from './useAccess'
import { useApi } from './useApi'

interface RecordPickerAccess {
  /** Pick the record to create a task in, which also needs the kind's task capability. */
  forTasks?: boolean
}
interface RecordPickerOptions extends RecordPickerAccess {
  /** Extra condition before the options load. */
  enabled?: MaybeRefOrGetter<boolean>
}

/** Whether the user may use the picker an application declares for `kind`. */
export function useRecordPickerAvailable(kind: string, options: RecordPickerAccess = {}) {
  const { can } = useAccess()
  return computed(() => {
    const picker = recordPickerFor(kind)
    if (!picker || !can(picker.capability)) return false
    return !options.forTasks || (picker.taskCapability !== undefined && can(picker.taskCapability))
  })
}

/** The options of the picker an application declares for `kind`, loaded once the user may use it. */
export function useRecordPicker(kind: string, options: RecordPickerOptions = {}) {
  const { $api } = useApi()
  const available = useRecordPickerAvailable(kind, options)
  const query = useQuery({
    queryKey: recordPickerFor(kind)?.queryKey ?? ['record-picker', kind],
    enabled: computed(() => available.value && toValue(options.enabled ?? true)),
    queryFn: ({ signal }) => {
      const picker = recordPickerFor(kind)
      if (!picker) throw new Error(`No application declares a record picker for ${kind}`)
      return picker.options($api, signal)
    },
    staleTime: 5 * 60 * 1000,
  })
  return { available, query }
}
