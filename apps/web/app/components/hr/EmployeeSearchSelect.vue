<script setup lang="ts">
import { refDebounced } from '@vueuse/core'
import { hrManagerOptions, useHrEmployee, useHrEmployees } from '@/composables/useHrEmployees'

// An employee filter that never holds the whole directory: it asks the server for one page of matches by name
// (`q`, debounced) and looks the chosen employee up by id, so a choice beyond the first page stays in the list.
const props = defineProps<{
  modelValue: number | null
  /** The shown text while nothing is chosen. */
  placeholder: string
  /** A filter offers this "no filter" item first; a required field leaves it out. */
  anyLabel?: string
  id: string
  testId?: string
  disabled?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: number | null] }>()

const { t } = useI18n()
const PAGE = 50
const ALL = 'all'
const search = ref('')
const debounced = refDebounced(search, 250)
const results = useHrEmployees(computed(() => ({ q: debounced.value.trim() || undefined, limit: PAGE })))
const selected = useHrEmployee(computed(() => props.modelValue))
const items = computed(() => {
  const found = results.data.value?.items ?? []
  const options = hrManagerOptions({ employees: found, searchResults: found, selected: selected.data.value, search: debounced.value })
  const named = options.map(employee => ({ value: String(employee.id), label: employee.name }))
  return props.anyLabel ? [{ value: ALL, label: props.anyLabel }, ...named] : named
})
const more = computed(() => (results.data.value?.total ?? 0) > (results.data.value?.items.length ?? 0))
</script>

<template>
  <USelectMenu
    v-model:search-term="search"
    ignore-filter
    :id="props.id"
    class="w-full"
    value-key="value"
    :model-value="props.modelValue ? String(props.modelValue) : undefined"
    :items="items"
    :placeholder="props.placeholder"
    :search-input="{ placeholder: t('hr.employeePicker.search'), icon: 'i-lucide-search' }"
    :disabled="props.disabled"
    :data-testid="props.testId"
    @update:model-value="emit('update:modelValue', $event && $event !== ALL ? Number($event) : null)"
  >
    <template v-if="more" #content-bottom>
      <p class="border-t border-default px-3 py-2 text-xs text-muted">{{ t('hr.employeePicker.more') }}</p>
    </template>
  </USelectMenu>
</template>
