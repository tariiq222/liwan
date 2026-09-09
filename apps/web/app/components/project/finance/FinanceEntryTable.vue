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
const budgets = computed(() => {
  const names = new Map<number, string>()
  for (const item of props.items) {
    if (item.kind === 'budget') names.set(item.id, item.title)
  }
  return names
})
</script>

<template>
  <div class="nasq-panel overflow-hidden">
    <div class="overflow-x-auto">
      <Table class="min-w-[720px] table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead class="w-28 text-start">{{ t('app.recordNumber') }}</TableHead>
            <TableHead class="text-start">{{ t('projects.finance.columns.title') }}</TableHead>
            <TableHead class="text-start">{{ t('projects.finance.columns.kind') }}</TableHead>
            <TableHead class="text-start">{{ t('projects.finance.columns.amount') }}</TableHead>
            <TableHead class="text-start">{{ t('projects.finance.columns.date') }}</TableHead>
            <TableHead class="text-start">{{ t('projects.finance.columns.budget') }}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <template v-if="isLoading || !hydrated">
            <TableRow v-for="n in 5" :key="n">
              <TableCell v-for="col in 6" :key="col"><Skeleton class="h-5 w-full" /></TableCell>
            </TableRow>
          </template>
          <TableEmpty v-else-if="items.length === 0" :colspan="6">
            <EmptyState
              :title="t(filtered ? 'projects.finance.filteredEmpty' : 'projects.finance.empty')"
              :description="t(filtered ? 'projects.finance.filteredEmptyHint' : 'projects.finance.emptyHint')"
            />
          </TableEmpty>
          <template v-else>
            <TableRow
              v-for="item in items"
              :key="item.id"
              class="cursor-pointer"
              data-testid="finance-entry-row"
              @click="hydrated && emit('open', item.id)"
            >
              <TableCell><RecordNumber :value="item.reference || item.id" /></TableCell>
              <TableCell>
                <NuxtLink
                  :to="{ path: `/projects/${projectId}/finance/${item.id}`, query: returnToQuery(route.fullPath) }"
                  class="block truncate font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  @click.stop
                >
                  {{ item.title }}
                </NuxtLink>
              </TableCell>
              <TableCell>{{ t(`projects.finance.kind.${item.kind}`) }}</TableCell>
              <TableCell><span dir="ltr" class="tabular-nums">{{ formatMoney(item.amount, summary.currency) }}</span></TableCell>
              <TableCell>{{ item.expense_date ? formatCalendarDate(item.expense_date, locale) : '—' }}</TableCell>
              <TableCell class="truncate">{{ item.budget_entry_id ? (budgets.get(item.budget_entry_id) ?? t('projects.finance.linkedBudget', { id: item.budget_entry_id })) : '—' }}</TableCell>
            </TableRow>
          </template>
        </TableBody>
      </Table>
    </div>
  </div>
</template>
