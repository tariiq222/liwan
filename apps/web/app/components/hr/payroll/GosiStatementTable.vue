<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { HrGosiStatement, HrGosiStatementLine } from '@webvue/contracts'
import { formatPayrollAmount } from '@/utils/payrollFormat'

// The GOSI statement of a fixed run: a row per employee with the capped contributory wage, the employee and employer
// share of each branch and their sums; the footer is the totals row, which prints.
const props = defineProps<{
  statement: HrGosiStatement
  caption: string
}>()

const { t, locale } = useI18n()
const BRANCHES = ['annuities', 'saned', 'hazards'] as const

const amount = (value: number) => formatPayrollAmount(value, locale.value)
const columns = computed<TableColumn<HrGosiStatementLine>[]>(() => [
  { id: 'employee', header: t('hrPayroll.gosiStatement.columns.employee') },
  { id: 'gosi_number', header: t('hrPayroll.gosiStatement.columns.gosiNumber') },
  { id: 'nationality_class', header: t('hrPayroll.gosiStatement.columns.nationalityClass') },
  { id: 'contributory_wage', header: t('hrPayroll.gosiStatement.columns.contributoryWage') },
  ...BRANCHES.map(branch => ({ id: branch, header: t(`hrPayroll.gosi.branch.${branch}`) })),
  { id: 'employee_amount', header: t('hrPayroll.gosiStatement.columns.employeeAmount') },
  { id: 'employer_amount', header: t('hrPayroll.gosiStatement.columns.employerAmount') },
])
</script>

<template>
  <SharedDataTable bare :rows="props.statement.lines" :columns="columns" :row-key="line => line.employee.id" :caption="props.caption">
    <template #employee-cell="{ row }"><span class="font-semibold text-highlighted">{{ row.original.employee.name }}</span></template>
    <template #gosi_number-cell="{ row }"><span class="tabular-nums" dir="ltr">{{ row.original.gosi_number || '—' }}</span></template>
    <template #nationality_class-cell="{ row }">{{ t(`hrPayroll.gosi.class.${row.original.nationality_class}`) }}</template>
    <template #contributory_wage-cell="{ row }"><span class="tabular-nums">{{ amount(row.original.contributory_wage) }}</span></template>
    <template v-for="branch in BRANCHES" :key="branch" #[`${branch}-cell`]="{ row }">
      <span class="tabular-nums">{{ amount(row.original.branches[branch].employee) }} / {{ amount(row.original.branches[branch].employer) }}</span>
    </template>
    <template #employee_amount-cell="{ row }"><span class="tabular-nums">{{ amount(row.original.employee_amount) }}</span></template>
    <template #employer_amount-cell="{ row }"><span class="tabular-nums">{{ amount(row.original.employer_amount) }}</span></template>
    <template #footer>
      <dl class="flex w-full flex-wrap items-center justify-end gap-x-6 gap-y-1" data-testid="hr-payroll-gosi-totals">
        <div class="flex gap-2"><dt>{{ t('hrPayroll.gosiStatement.columns.contributoryWage') }}</dt><dd class="tabular-nums text-highlighted">{{ amount(props.statement.totals.contributory_wage) }}</dd></div>
        <div class="flex gap-2"><dt>{{ t('hrPayroll.gosiStatement.columns.employeeAmount') }}</dt><dd class="tabular-nums text-highlighted">{{ amount(props.statement.totals.employee_amount) }}</dd></div>
        <div class="flex gap-2"><dt>{{ t('hrPayroll.gosiStatement.columns.employerAmount') }}</dt><dd class="font-semibold tabular-nums text-highlighted">{{ amount(props.statement.totals.employer_amount) }}</dd></div>
      </dl>
    </template>
  </SharedDataTable>
</template>
