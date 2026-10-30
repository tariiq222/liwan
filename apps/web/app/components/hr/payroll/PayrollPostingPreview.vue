<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { HrPayrollPostingPreview } from '@liwan/contracts'
import { formatDate } from '@liwan/ui/app/utils/formatDate'
import { formatPayrollAmount } from '@/utils/payrollFormat'

// The accounting entry a posting would create, shown inline before the run is posted: the entry's date and journal,
// the warnings the server found (they do not block posting), the lines and their totals. Not printed.
type Line = HrPayrollPostingPreview['lines'][number]
const props = defineProps<{ preview: HrPayrollPostingPreview }>()

const { t, te, locale } = useI18n()

const amount = (value: number) => formatPayrollAmount(value, locale.value)
const columns = computed<TableColumn<Line>[]>(() => [
  { id: 'account', header: t('hrPayroll.finance.preview.columns.account') },
  { id: 'analytic', header: t('hrPayroll.finance.preview.columns.analytic') },
  { id: 'employee', header: t('hrPayroll.finance.preview.columns.employee') },
  { id: 'debit', header: t('hrPayroll.finance.preview.columns.debit') },
  { id: 'credit', header: t('hrPayroll.finance.preview.columns.credit') },
])
const warnings = computed(() => props.preview.warnings.map(warning => ({
  key: `${warning.code}:${warning.employee.id}`,
  text: te(`hrPayroll.warnings.${warning.code}`) ? t(`hrPayroll.warnings.${warning.code}`, { name: warning.employee.name }) : `${warning.code}: ${warning.employee.name}`,
})))
const lineKey = (line: Line) => `${line.account.id}:${line.analytic_account?.id ?? 0}:${line.employee?.id ?? 0}:${line.debit}:${line.credit}`
</script>

<template>
  <div class="liwan-print-hide grid gap-3" data-testid="hr-payroll-posting-preview">
    <h3 class="font-semibold text-highlighted">{{ t('hrPayroll.finance.preview.title') }}</h3>
    <dl class="flex flex-wrap gap-x-6 gap-y-1 text-sm">
      <div class="flex gap-1"><dt class="text-muted">{{ t('hrPayroll.finance.preview.date') }}:</dt><dd class="tabular-nums">{{ formatDate(props.preview.date) }}</dd></div>
      <div class="flex gap-1"><dt class="text-muted">{{ t('hrPayroll.finance.preview.journal') }}:</dt><dd>{{ props.preview.journal.name }}</dd></div>
      <div class="flex gap-1"><dt class="text-muted">{{ t('hrPayroll.finance.preview.detail') }}:</dt><dd>{{ t(`hrPayroll.finance.preview.${props.preview.entry_detail}`) }}</dd></div>
    </dl>
    <UAlert
      v-if="warnings.length"
      color="warning"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      :title="t('hrPayroll.finance.preview.warningsTitle')"
      data-testid="hr-payroll-posting-warnings"
    >
      <template #description>
        <ul class="list-disc ps-5">
          <li v-for="warning in warnings" :key="warning.key">{{ warning.text }}</li>
        </ul>
      </template>
    </UAlert>
    <SharedDataTable
      :rows="props.preview.lines"
      :columns="columns"
      :row-key="lineKey"
      :empty-text="t('hrPayroll.finance.preview.empty')"
      :caption="t('hrPayroll.finance.preview.title')"
    >
      <template #account-cell="{ row }"><span class="tabular-nums text-muted">{{ row.original.account.code }}</span> {{ row.original.account.name }}</template>
      <template #analytic-cell="{ row }">{{ row.original.analytic_account?.name ?? '—' }}</template>
      <template #employee-cell="{ row }">{{ row.original.employee?.name ?? '—' }}</template>
      <template #debit-cell="{ row }"><span class="tabular-nums">{{ row.original.debit ? amount(row.original.debit) : '—' }}</span></template>
      <template #credit-cell="{ row }"><span class="tabular-nums">{{ row.original.credit ? amount(row.original.credit) : '—' }}</span></template>
      <template #mobile-row="{ row }">
        <div class="flex items-center justify-between gap-2">
          <span class="font-semibold text-highlighted">{{ row.account.name }}</span>
          <span class="tabular-nums">{{ amount(row.debit || row.credit) }}</span>
        </div>
        <p class="mt-1 text-sm text-muted">{{ row.employee?.name ?? row.analytic_account?.name ?? '' }}</p>
      </template>
    </SharedDataTable>
    <p class="flex flex-wrap justify-end gap-x-6 text-sm font-semibold" data-testid="hr-payroll-posting-totals">
      <span>{{ t('hrPayroll.finance.preview.totals') }}</span>
      <span class="tabular-nums">{{ t('hrPayroll.finance.preview.columns.debit') }}: {{ amount(props.preview.debit) }}</span>
      <span class="tabular-nums">{{ t('hrPayroll.finance.preview.columns.credit') }}: {{ amount(props.preview.credit) }}</span>
    </p>
  </div>
</template>
