<script setup lang="ts">
import { refDebounced } from '@vueuse/core'
import { useProjectFinanceList } from '@/composables/useProjectFinance'
import { FINANCE_PAGE, nextOffsetAfterListResult } from '@/utils/projectFinance'
import { parsePositiveId } from '@/utils/routeParams'

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
  <UFormField name="budget_entry_id" :label="t('projects.finance.fields.budget_entry_id')" :error="error" data-testid="finance-budget-picker">
    <div class="grid gap-2">
      <UInput
        id="finance-budget-search"
        v-model="search"
        class="w-full"
        icon="i-lucide-search"
        :disabled="disabled || !hydrated"
        :placeholder="t('projects.finance.searchBudgets')"
        :aria-label="t('projects.finance.searchBudgets')"
      />
      <USelect
        id="finance-budget-entry"
        :model-value="selectedValue"
        :items="budgetItems"
        :disabled="disabled || !hydrated"
        class="w-full"
        :aria-label="t('projects.finance.fields.budget_entry_id')"
        @update:model-value="onSelect"
      />
      <SharedPagination :page="page" :pages="pages" :disabled="disabled || list.isFetching.value" @update:page="setPage" />
      <p v-if="list.error.value" role="alert" class="text-sm text-error">{{ t('projects.finance.budgetPickerError') }}</p>
    </div>
  </UFormField>
</template>
