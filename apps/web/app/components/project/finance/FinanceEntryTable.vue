<script setup lang="ts">
import type { FinanceEntry, FinanceSummary } from '@nasq/contracts'
import EmptyState from '@/components/shared/EmptyState.vue'
import { formatCalendarDate } from '@/composables/calendarDate'
import { formatMoney } from '@/utils/projectFinance'
import { returnToQuery } from '@/utils/safeReturnTo'
import RecordNumber from '@/components/shared/RecordNumber.vue'

const props = defineProps<{
  projectId: number
  items: FinanceEntry[]
  summary: FinanceSummary
  isLoading: boolean
  filtered: boolean
}>()
const emit = defineEmits<{ open: [id: number] }>()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const route = useRoute()
const compactRecords = ref(false)
const loading = computed(() => props.isLoading || !hydrated.value)
const budgets = computed(() => {
  const names = new Map<number, string>()
  for (const item of props.items) {
    if (item.kind === 'budget') names.set(item.id, item.title)
  }
  return names
})
const columns = computed(() => [
  { id: 'record', header: t('app.recordNumber') },
  { id: 'title', header: t('projects.finance.columns.title') },
  { id: 'kind', header: t('projects.finance.columns.kind') },
  { id: 'amount', header: t('projects.finance.columns.amount') },
  { id: 'date', header: t('projects.finance.columns.date') },
  { id: 'budget', header: t('projects.finance.columns.budget') },
])

onMounted(() => {
  const query = window.matchMedia('(max-width: 767px)')
  const sync = () => { compactRecords.value = query.matches }
  sync()
  query.addEventListener('change', sync)
  onUnmounted(() => query.removeEventListener('change', sync))
})

function budgetLabel(item: FinanceEntry) {
  if (!item.budget_entry_id) return '—'
  return budgets.value.get(item.budget_entry_id) ?? t('projects.finance.linkedBudget', { id: item.budget_entry_id })
}

function open(id: number) {
  if (!hydrated.value) return
  emit('open', id)
}

function onSelect(_event: Event, row: { original: FinanceEntry }) {
  open(row.original.id)
}
</script>

<template>
  <div class="rounded-xl border border-default overflow-hidden">
    <UTable
      v-if="!compactRecords"
      :data="loading ? [] : items"
      :columns="columns"
      :loading="loading"
      :caption="t('projects.finance.columns.title')"
      :ui="{ caption: 'sr-only' }"
      :on-select="hydrated ? onSelect : undefined"
    >
      <template #loading>
        <div class="grid gap-3 p-4" role="status" :aria-label="$t('app.loading')">
          <USkeleton v-for="n in 5" :key="n" class="h-5 w-full" />
        </div>
      </template>
      <template #empty>
        <EmptyState
          :title="t(filtered ? 'projects.finance.filteredEmpty' : 'projects.finance.empty')"
          :description="t(filtered ? 'projects.finance.filteredEmptyHint' : 'projects.finance.emptyHint')"
        />
      </template>
      <template #record-cell="{ row }">
        <RecordNumber :value="row.original.reference || row.original.id" />
      </template>
      <template #title-cell="{ row }">
        <div data-testid="finance-entry-row">
          <UButton
            color="neutral"
            variant="link"
            class="block truncate p-0 font-medium text-start"
            :to="{ path: `/projects/${projectId}/finance/${row.original.id}`, query: returnToQuery(route.fullPath) }"
            @click.stop
          >
            {{ row.original.title }}
          </UButton>
        </div>
      </template>
      <template #kind-cell="{ row }">{{ t(`projects.finance.kind.${row.original.kind}`) }}</template>
      <template #amount-cell="{ row }"><span dir="ltr" class="tabular-nums">{{ formatMoney(row.original.amount, summary.currency) }}</span></template>
      <template #date-cell="{ row }">{{ row.original.expense_date ? formatCalendarDate(row.original.expense_date, locale) : '—' }}</template>
      <template #budget-cell="{ row }"><span class="truncate">{{ budgetLabel(row.original) }}</span></template>
    </UTable>

    <div v-else>
      <div v-if="loading" class="grid gap-4 p-4" role="status" :aria-label="$t('app.loading')">
        <USkeleton v-for="n in 5" :key="n" class="h-24 w-full" />
      </div>
      <EmptyState
        v-else-if="items.length === 0"
        :title="t(filtered ? 'projects.finance.filteredEmpty' : 'projects.finance.empty')"
        :description="t(filtered ? 'projects.finance.filteredEmptyHint' : 'projects.finance.emptyHint')"
      />
      <ul v-else class="grid divide-y divide-default" :aria-label="t('projects.finance.columns.title')">
        <li
          v-for="item in items"
          :key="item.id"
          class="grid cursor-pointer gap-3 p-4"
          data-testid="finance-entry-row"
          @click="open(item.id)"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <RecordNumber :value="item.reference || item.id" />
              <UButton
                color="neutral"
                variant="link"
                class="mt-1 block p-0 text-start font-medium whitespace-normal"
                :to="{ path: `/projects/${projectId}/finance/${item.id}`, query: returnToQuery(route.fullPath) }"
                @click.stop
              >
                {{ item.title }}
              </UButton>
            </div>
            <span class="shrink-0 text-sm">{{ t(`projects.finance.kind.${item.kind}`) }}</span>
          </div>
          <dl class="grid grid-cols-2 gap-3 text-xs">
            <div>
              <dt class="text-muted">{{ t('projects.finance.columns.amount') }}</dt>
              <dd dir="ltr" class="tabular-nums">{{ formatMoney(item.amount, summary.currency) }}</dd>
            </div>
            <div>
              <dt class="text-muted">{{ t('projects.finance.columns.date') }}</dt>
              <dd>{{ item.expense_date ? formatCalendarDate(item.expense_date, locale) : '—' }}</dd>
            </div>
            <div class="col-span-2">
              <dt class="text-muted">{{ t('projects.finance.columns.budget') }}</dt>
              <dd>{{ budgetLabel(item) }}</dd>
            </div>
          </dl>
        </li>
      </ul>
    </div>
  </div>
</template>
