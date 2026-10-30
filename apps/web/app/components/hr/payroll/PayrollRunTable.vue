<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { RouteLocationRaw } from 'vue-router'
import type { HrPayrollRunSummary } from '@liwan/contracts'
import RecordNumber from '@liwan/ui/app/components/shared/data/RecordNumber.vue'
import { recordNumberHeader } from '@liwan/ui/app/utils/recordNumberHeader'
import { formatDate } from '@liwan/ui/app/utils/formatDate'
import { formatPayrollAmount, formatPayrollMonth, payrollRunStateTone, payrollCurrencyLabel } from '@/utils/payrollFormat'

// The runs table of /hr/payroll: one row per payroll month with its state pill and totals. It is a bare
// SharedDataTable inside the page's SharedListCard.
const props = defineProps<{
  runs: HrPayrollRunSummary[]
  rowTo: (row: HrPayrollRunSummary) => RouteLocationRaw
  caption: string
  loading?: boolean
}>()

const { t, locale } = useI18n()

const columns = computed<TableColumn<HrPayrollRunSummary>[]>(() => [
  { accessorKey: 'id', header: () => recordNumberHeader(t), meta: { class: { th: 'w-[48px] min-w-[48px] px-2', td: 'w-[48px] min-w-[48px] px-2' } } },
  { accessorKey: 'month', header: t('hrPayroll.runs.columns.month') },
  { accessorKey: 'state', header: t('hrPayroll.runs.columns.state'), meta: { class: { th: 'w-[110px]', td: 'w-[110px]' } } },
  { accessorKey: 'employee_count', header: t('hrPayroll.runs.columns.employees') },
  { id: 'gross', header: t('hrPayroll.runs.columns.gross') },
  { id: 'deductions', header: t('hrPayroll.runs.columns.deductions') },
  { id: 'net', header: t('hrPayroll.runs.columns.net') },
  { accessorKey: 'approved_at', header: t('hrPayroll.runs.columns.approvedAt') },
])

const amount = (value: number) => formatPayrollAmount(value, locale.value)
</script>

<template>
  <SharedDataTable
    bare
    :rows="props.runs"
    :columns="columns"
    row-key="id"
    :row-to="props.rowTo"
    :loading="props.loading"
    :caption="props.caption"
  >
    <template #id-cell="{ row }"><RecordNumber :value="row.original.id" :data-testid="`hr-payroll-run-${row.original.id}`" /></template>
    <template #month-cell="{ row }">
      <NuxtLink :to="props.rowTo(row.original)" class="rounded font-semibold text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{{ formatPayrollMonth(row.original.month, locale) }}</NuxtLink>
    </template>
    <template #state-cell="{ row }">
      <SharedStatusBadge size="sm" :tone="payrollRunStateTone(row.original.state)" :label="t(`hrPayroll.runs.state.${row.original.state}`)" data-testid="hr-payroll-run-state" />
    </template>
    <template #employee_count-cell="{ row }"><span class="tabular-nums">{{ row.original.employee_count }}</span></template>
    <template #gross-cell="{ row }"><span class="tabular-nums">{{ amount(row.original.totals.gross) }}</span></template>
    <template #deductions-cell="{ row }"><span class="tabular-nums">{{ amount(row.original.totals.deductions) }}</span></template>
    <template #net-cell="{ row }"><span class="font-semibold tabular-nums text-highlighted">{{ amount(row.original.totals.net) }} {{ payrollCurrencyLabel(row.original.currency, t('hrPayroll.currency')) }}</span></template>
    <template #approved_at-cell="{ row }">
      <span v-if="row.original.approved_at" class="tabular-nums">{{ formatDate(row.original.approved_at) }}</span>
      <span v-else class="text-muted">—</span>
    </template>
    <template #mobile-row="{ row }">
      <div class="flex items-center justify-between gap-2">
        <span class="font-semibold text-highlighted">{{ formatPayrollMonth(row.month, locale) }}</span>
        <SharedStatusBadge size="sm" :tone="payrollRunStateTone(row.state)" :label="t(`hrPayroll.runs.state.${row.state}`)" />
      </div>
      <p class="mt-1 text-sm">{{ t('hrPayroll.runs.employeeCount', { count: row.employee_count }, row.employee_count) }} · {{ amount(row.totals.net) }} {{ payrollCurrencyLabel(row.currency, t('hrPayroll.currency')) }}</p>
    </template>
  </SharedDataTable>
</template>
