<script setup lang="ts" generic="T extends { id: number }">
import { refDebounced } from '@vueuse/core'

// The base of the pickers that choose one record of a service by name (SharedProductPicker, SharedCustomerPicker): a
// search box, a list of rows to tap, and the loading, error and empty states. The caller owns the data: it reads the
// debounced `update:search` term, passes the rows it found (`items`) with `loading` and `error`, and draws a row in the
// `row` slot. Tap a row to pick it and tap it again to drop it. `notice` sits between the search box and the list. An
// empty list with no search term shows `emptyText`, and `createTo` (only for someone who may add one) links to the form
// that adds a record.
const props = defineProps<{
  modelValue: number | null
  items: T[]
  loading?: boolean
  error?: unknown
  disabled?: boolean
  /** The prefix of every `data-testid`: the root, `-search`, `-empty`, `-create` and `-option-<id>`. */
  testId: string
  searchLabel: string
  listLabel: string
  emptyText: string
  ariaLabel?: string
  createTo?: string
  createLabel?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: number | null]; resolve: [item: T | null]; 'update:search': [value: string]; retry: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const q = ref('')
const searching = computed(() => q.value.trim() !== '')
const view = computed(() => props.loading ? 'loading' : props.error ? 'error' : props.items.length ? 'list' : 'empty')
const off = computed(() => props.disabled || !hydrated.value)
const debounced = refDebounced(q, 250)
watch(debounced, value => emit('update:search', value))

function toggle(item: T) {
  const picked = props.modelValue === item.id
  emit('update:modelValue', picked ? null : item.id)
  emit('resolve', picked ? null : item)
}
</script>

<template>
  <div class="flex flex-col gap-2" :data-testid="testId">
    <UInput v-model="q" class="w-full" icon="i-lucide-search" :placeholder="searchLabel" :aria-label="ariaLabel ?? searchLabel" :disabled="off" :data-testid="`${testId}-search`" @keydown.enter.prevent />
    <slot name="notice" />
    <SharedLoadingSkeleton v-if="view === 'loading'" />
    <SharedPageState v-else-if="view === 'error'" :error="error" @retry="emit('retry')" />
    <p v-else-if="view === 'empty'" class="text-sm text-muted" :data-testid="`${testId}-empty`">
      {{ searching ? t('app.noResults') : emptyText }}
      <NuxtLink v-if="!searching && createTo" :to="createTo" class="font-medium text-primary hover:underline" :data-testid="`${testId}-create`">{{ createLabel }}</NuxtLink>
    </p>
    <ul v-else class="flex max-h-72 flex-col divide-y divide-default overflow-y-auto rounded-control ring ring-default" :aria-label="listLabel">
      <li v-for="item in items" :key="item.id">
        <button
          type="button"
          class="flex w-full items-center gap-3 px-3 py-2 text-start transition-colors hover:bg-elevated focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary disabled:opacity-50"
          :class="{ 'bg-(--brand-soft)': modelValue === item.id }"
          :aria-pressed="modelValue === item.id"
          :disabled="off"
          :data-testid="`${testId}-option-${item.id}`"
          @click="toggle(item)"
        >
          <slot name="row" :item="item" />
          <UIcon :name="modelValue === item.id ? 'i-lucide-circle-check' : 'i-lucide-circle'" class="size-5 shrink-0" :class="modelValue === item.id ? 'text-primary' : 'text-muted'" aria-hidden="true" />
        </button>
      </li>
    </ul>
  </div>
</template>
