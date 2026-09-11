<script setup lang="ts">
import { refDebounced } from '@vueuse/core'
import { useProjectFinanceList } from '@/composables/useProjectFinance'
import { FINANCE_PAGE, nextOffsetAfterListResult, parsePositiveId } from '@/utils/projectFinance'

const props = defineProps<{
  projectId: number
  modelValue: number | null
  disabled?: boolean
  selectedLabel?: string | null
  error?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: number | null] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const search = ref('')
const offset = ref(0)
const debouncedSearch = refDebounced(search, 250)
const filters = computed(() => ({
  kind: 'budget' as const,
  q: debouncedSearch.value.trim() || undefined,
  limit: FINANCE_PAGE,
  offset: offset.value,
}))
const list = useProjectFinanceList(computed(() => parsePositiveId(props.projectId)), filters)
const items = computed(() => list.data.value?.items ?? [])
const total = computed(() => list.data.value?.total ?? 0)
const page = computed(() => Math.floor(offset.value / FINANCE_PAGE) + 1)
const pages = computed(() => Math.max(1, Math.ceil(total.value / FINANCE_PAGE)))
const selectedOnPage = computed(() => items.value.some(item => item.id === props.modelValue))
const selectedValue = computed(() => props.modelValue ? String(props.modelValue) : 'none')
const budgetItems = computed(() => {
  const options = [{ value: 'none', label: t('projects.finance.budgetNone') }]
  if (props.modelValue && !selectedOnPage.value) {
    options.push({
      value: String(props.modelValue),
      label: props.selectedLabel || t('projects.finance.linkedBudget', { id: props.modelValue }),
    })
  }
  for (const item of items.value) options.push({ value: String(item.id), label: item.title })
  return options
})

watch(debouncedSearch, (value, previous) => {
  if (value.trim() === (previous ?? '').trim()) return
  offset.value = 0
})
watch(
  () => ({
    fetching: list.isFetching.value,
    offset: offset.value,
    queryOffset: filters.value.offset,
    total: list.data.value?.total,
  }),
  ({ fetching, offset: current, queryOffset, total }) => {
    const next = nextOffsetAfterListResult({
      isFetching: fetching,
      requestedOffset: current,
      responseOffset: queryOffset,
      total,
      pageSize: FINANCE_PAGE,
    })
    if (next === null) return
    offset.value = next
  },
)

function onSelect(value: unknown) {
  if (value === 'none' || value == null || value === '') {
    emit('update:modelValue', null)
    return
  }
  const id = Number(value)
  emit('update:modelValue', Number.isInteger(id) && id > 0 ? id : null)
}

function setPage(next: number) {
  if (!hydrated.value || list.isFetching.value || next < 1 || next > pages.value) return
  offset.value = (next - 1) * FINANCE_PAGE
}
</script>

<template>
  <div class="grid gap-2" data-testid="finance-budget-picker">
    <label for="finance-budget-entry" class="block font-medium text-default">{{ t('projects.finance.fields.budget_entry_id') }}</label>
    <div class="space-y-2">
      <label for="finance-budget-search" class="sr-only">{{ t('projects.finance.searchBudgets') }}</label>
      <UInput
        id="finance-budget-search"
        v-model="search"
        class="w-full"
        :disabled="disabled || !hydrated"
        :placeholder="t('projects.finance.searchBudgets')"
        :aria-label="t('projects.finance.searchBudgets')"
      />
    </div>
    <USelect
      id="finance-budget-entry"
      :model-value="selectedValue"
      :items="budgetItems"
      :disabled="disabled || !hydrated"
      class="w-full"
      :color="error ? 'error' : undefined"
      :highlight="!!error"
      :aria-invalid="!!error"
      :aria-describedby="error ? 'finance-budget-entry-error' : undefined"
      @update:model-value="onSelect"
    />
    <p v-if="error" id="finance-budget-entry-error" role="alert" class="text-sm text-error">{{ error }}</p>
    <div v-if="pages > 1" class="flex items-center justify-between text-xs text-muted">
      <UButton type="button" color="secondary" variant="ghost" size="sm" :disabled="!hydrated || page === 1 || list.isFetching.value" @click="setPage(page - 1)">
        {{ t('projects.previousPage') }}
      </UButton>
      <span>{{ t('projects.pageOf', { page, pages }) }}</span>
      <UButton type="button" color="secondary" variant="ghost" size="sm" :disabled="!hydrated || page >= pages || list.isFetching.value" @click="setPage(page + 1)">
        {{ t('projects.nextPage') }}
      </UButton>
    </div>
    <p v-if="list.error.value" class="text-sm text-error">{{ t('projects.finance.budgetPickerError') }}</p>
  </div>
</template>
