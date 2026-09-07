<script setup lang="ts">
import { refDebounced } from '@vueuse/core'
import { useProjectFinanceList } from '@/composables/useProjectFinance'
import { FINANCE_PAGE, nextOffsetAfterListResult, parsePositiveId } from '@/utils/projectFinance'

const props = defineProps<{
  projectId: number
  modelValue: number | null
  disabled?: boolean
  selectedLabel?: string | null
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
    <Label>{{ t('projects.finance.fields.budget_entry_id') }}</Label>
    <Input
      v-model="search"
      :disabled="disabled || !hydrated"
      :placeholder="t('projects.finance.searchBudgets')"
      :aria-label="t('projects.finance.searchBudgets')"
    />
    <Select :model-value="modelValue ? String(modelValue) : 'none'" :disabled="disabled || !hydrated" @update:model-value="onSelect">
      <SelectTrigger class="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">{{ t('projects.finance.budgetNone') }}</SelectItem>
        <SelectItem
          v-if="modelValue && !selectedOnPage"
          :value="String(modelValue)"
        >
          {{ selectedLabel || t('projects.finance.linkedBudget', { id: modelValue }) }}
        </SelectItem>
        <SelectItem v-for="item in items" :key="item.id" :value="String(item.id)">{{ item.title }}</SelectItem>
      </SelectContent>
    </Select>
    <div v-if="pages > 1" class="flex items-center justify-between text-xs text-muted-foreground">
      <Button type="button" variant="ghost" size="sm" :disabled="!hydrated || page === 1 || list.isFetching.value" @click="setPage(page - 1)">
        {{ t('projects.previousPage') }}
      </Button>
      <span>{{ t('projects.pageOf', { page, pages }) }}</span>
      <Button type="button" variant="ghost" size="sm" :disabled="!hydrated || page >= pages || list.isFetching.value" @click="setPage(page + 1)">
        {{ t('projects.nextPage') }}
      </Button>
    </div>
    <p v-if="list.error.value" class="text-sm text-destructive">{{ t('projects.finance.budgetPickerError') }}</p>
  </div>
</template>
