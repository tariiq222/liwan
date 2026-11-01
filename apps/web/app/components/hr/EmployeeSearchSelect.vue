<script setup lang="ts">
import { refDebounced } from '@vueuse/core'
import { hrManagerOptions, useHrEmployee, useHrEmployees } from '@/composables/useHrEmployees'

// An employee filter that never holds the whole directory: it asks the server for one page of matches by name
// (`q`, debounced) and looks the chosen employee up by id, so a choice beyond the first page stays in the list.
const props = defineProps<{
  modelValue: number | null
  /** The label of the "no filter" item and the placeholder while nothing is chosen. */
  anyLabel: string
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
  return [{ value: ALL, label: props.anyLabel }, ...options.map(employee => ({ value: String(employee.id), label: employee.name }))]
})
const more = computed(() => (results.data.value?.total ?? 0) > (results.data.value?.items.length ?? 0))
</script>

<template>
  <div class="grid gap-2">
    <UInput v-model="search" class="w-full" icon="i-lucide-search" :placeholder="t('hr.employeePicker.search')" :aria-label="t('hr.employeePicker.search')" :disabled="props.disabled" :data-testid="props.testId ? `${props.testId}-search` : undefined" />
    <USelect
      :id="props.id"
      class="w-full"
      :model-value="props.modelValue ? String(props.modelValue) : undefined"
      :items="items"
      :placeholder="props.anyLabel"
      :disabled="props.disabled"
      :data-testid="props.testId"
      @update:model-value="emit('update:modelValue', $event && $event !== ALL ? Number($event) : null)"
    />
    <p v-if="more" class="text-xs text-muted">{{ t('hr.employeePicker.more') }}</p>
  </div>
</template>
