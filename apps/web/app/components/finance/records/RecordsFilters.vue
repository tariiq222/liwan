<script setup lang="ts">
import type { RecordFilters } from './recordParams'

// The filter bar of a setup list: a search box (when the API has one), one kind choice and the active or archived switch.
// It only reports what the user chose; the list owns the URL.
const props = defineProps<{
  filters: RecordFilters
  activeCount: number
  hydrated: boolean
  /** The search text being typed (v-model) and its placeholder; both absent when the list has no search. */
  search?: string
  searchPlaceholder?: string
  /** The choices of the kind filter, without the "all" row, and the label of the filter. */
  kinds?: readonly { value: string; label: string }[]
  kindLabel?: string
  allLabel?: string
  idPrefix: string
}>()
const emit = defineEmits<{
  'update:search': [value: string]
  submit: []
  clear: []
  kind: [value: unknown]
  state: [value: unknown]
}>()
const { t } = useI18n()
const kindItems = computed(() => [{ value: 'all', label: props.allLabel ?? t('financeRecords.filters.all') }, ...(props.kinds ?? [])])
const stateItems = computed(() => (['active', 'archived'] as const).map(value => ({ value, label: t(`financeRecords.states.${value}`) })))
</script>

<template>
  <SharedFilterBar inline :active-count="activeCount" :default-open="!!filters.kind || filters.archived" :disabled="!hydrated" @clear="emit('clear')">
    <template v-if="search !== undefined" #search>
      <form @submit.prevent="emit('submit')">
        <UInput :model-value="search" class="w-full" icon="i-lucide-search" :placeholder="searchPlaceholder" :aria-label="searchPlaceholder" :disabled="!hydrated" @update:model-value="value => emit('update:search', String(value))" />
      </form>
    </template>
    <SharedFilterField v-if="kinds" :label="kindLabel ?? ''" :for="`${idPrefix}-filter-kind`">
      <USelect :id="`${idPrefix}-filter-kind`" class="w-full md:w-56" :model-value="filters.kind ?? 'all'" :items="kindItems" :disabled="!hydrated" @update:model-value="value => emit('kind', value)" />
    </SharedFilterField>
    <SharedFilterField :label="t('financeRecords.filters.state')" :for="`${idPrefix}-filter-state`">
      <USelect :id="`${idPrefix}-filter-state`" class="w-full md:w-40" :model-value="filters.archived ? 'archived' : 'active'" :items="stateItems" :disabled="!hydrated" @update:model-value="value => emit('state', value)" />
    </SharedFilterField>
  </SharedFilterBar>
</template>
