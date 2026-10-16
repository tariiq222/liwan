<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { h } from 'vue'
import type { RouteLocationRaw } from 'vue-router'
import type { FinanceEntry, FinanceSummary } from '@webvue/contracts'
import RecordNumber from '@webvue/ui/app/components/shared/data/RecordNumber.vue'
import type { RowAction } from '@webvue/ui/app/components/shared/data/RowActions.vue'
import { formatCalendarDate } from '@webvue/ui/app/composables/calendarDate'
import { formatMoney } from '@/utils/projectFinance'
import { recordChildTo } from '@/utils/recordListOrigin'

// The ledger on SharedDataTable. A row link, Enter and a background click open the entry through `rowTo`;
// the empty state, the error and the paging belong to the page.
const props = defineProps<{
  projectId: number
  items: FinanceEntry[]
  summary: FinanceSummary
  isLoading: boolean
  rowTo: (item: FinanceEntry) => RouteLocationRaw
  canManage?: boolean
}>()
const { t, locale } = useI18n()
const router = useRouter()
function openLiveEntry(event: MouseEvent, item: FinanceEntry) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  void router.push(props.rowTo(item))
}
const budgets = computed(() => new Map(props.items.filter(item => item.kind === 'budget').map(item => [item.id, item.title])))
const columns = computed<TableColumn<FinanceEntry>[]>(() => [
  { id: 'record', header: t('app.recordNumber') },
  { id: 'title', header: t('projects.finance.columns.title') },
  { id: 'kind', header: t('projects.finance.columns.kind') },
  { id: 'amount', header: t('projects.finance.columns.amount') },
  { id: 'date', header: t('projects.finance.columns.date') },
  { id: 'budget', header: t('projects.finance.columns.budget') },
  ...(props.canManage ? [{ id: 'actions', header: () => h('span', { class: 'sr-only' }, t('app.actions')), meta: { class: { th: 'w-0', td: 'w-0 text-end' } } }] : []),
])
// Deletion stays on the entry page, where its inline confirmation lives.
function entryActions(item: FinanceEntry): RowAction[] {
  return [{ label: t('app.edit'), icon: 'i-lucide-pencil', to: recordChildTo(`/projects/${props.projectId}/finance/${item.id}/edit`, router.resolve(props.rowTo(item)).query, [`/projects/${props.projectId}/finance`]) }]
}
function budgetLabel(item: FinanceEntry) {
  if (!item.budget_entry_id) return '—'
  return budgets.value.get(item.budget_entry_id) ?? t('projects.finance.linkedBudget', { id: item.budget_entry_id })
}
const dateLabel = (item: FinanceEntry) => (item.expense_date ? formatCalendarDate(item.expense_date, locale.value) : '—')
</script>

<template>
  <SharedDataTable :rows="items" :columns="columns" row-key="id" :row-to="rowTo" :loading="isLoading" :caption="t('projects.finance.columns.title')">
    <template #record-cell="{ row }"><RecordNumber :value="row.original.reference || row.original.id" /></template>
    <template #title-cell="{ row }">
      <div data-testid="finance-entry-row" class="min-w-0">
        <NuxtLink :to="rowTo(row.original)" @click="openLiveEntry($event, row.original)" class="block truncate font-medium text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{{ row.original.title }}</NuxtLink>
      </div>
    </template>
    <template #kind-cell="{ row }">{{ t(`projects.finance.kind.${row.original.kind}`) }}</template>
    <template #amount-cell="{ row }"><span dir="ltr" class="tabular-nums">{{ formatMoney(row.original.amount, summary.currency) }}</span></template>
    <template #date-cell="{ row }">{{ dateLabel(row.original) }}</template>
    <template #budget-cell="{ row }"><span class="truncate">{{ budgetLabel(row.original) }}</span></template>
    <template #actions-cell="{ row }">
      <SharedRowActions :actions="entryActions(row.original)" :label="t('projects.finance.actionsNamed', { name: row.original.title })" />
    </template>
    <template #mobile-row="{ row: item }">
      <div data-testid="finance-entry-card" class="grid gap-3">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <RecordNumber :value="item.reference || item.id" />
            <NuxtLink :to="rowTo(item)" @click="openLiveEntry($event, item)" class="mt-1 block font-medium text-highlighted hover:underline">{{ item.title }}</NuxtLink>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <span class="text-sm">{{ t(`projects.finance.kind.${item.kind}`) }}</span>
            <SharedRowActions v-if="canManage" :actions="entryActions(item)" :label="t('projects.finance.actionsNamed', { name: item.title })" />
          </div>
        </div>
        <dl class="grid grid-cols-2 gap-3 text-xs">
          <div><dt class="text-muted">{{ t('projects.finance.columns.amount') }}</dt><dd dir="ltr" class="tabular-nums">{{ formatMoney(item.amount, summary.currency) }}</dd></div>
          <div><dt class="text-muted">{{ t('projects.finance.columns.date') }}</dt><dd>{{ dateLabel(item) }}</dd></div>
          <div class="col-span-2"><dt class="text-muted">{{ t('projects.finance.columns.budget') }}</dt><dd>{{ budgetLabel(item) }}</dd></div>
        </dl>
      </div>
    </template>
  </SharedDataTable>
</template>
