<script setup lang="ts">
import type { HrPayrollTotals } from '@webvue/contracts'
import type { KpiTile } from '@webvue/ui/app/utils/kpiTile'
import { formatPayrollAmount, payrollCurrencyLabel } from '@/utils/payrollFormat'

// The four figures of one payroll run above its register: what the employees get, what is deducted
// (the employees' GOSI share is part of it), and what the employer owes on top. Hidden on paper: the register prints its own totals row.
const props = defineProps<{
  totals: HrPayrollTotals
  employeeCount: number
  currency: string
  loading?: boolean
}>()

const { t, locale } = useI18n()
const money = (value: number) => `${formatPayrollAmount(value, locale.value)} ${payrollCurrencyLabel(props.currency, t('hrPayroll.currency'))}`

const tiles = computed<KpiTile[]>(() => [
  { id: 'net', label: t('hrPayroll.totals.net'), value: money(props.totals.net), icon: 'i-lucide-banknote', tone: 'success', hint: t('hrPayroll.runs.employeeCount', { count: props.employeeCount }, props.employeeCount) },
  { id: 'gross', label: t('hrPayroll.totals.gross'), value: money(props.totals.gross), icon: 'i-lucide-wallet' },
  { id: 'deductions', label: t('hrPayroll.totals.deductions'), value: money(props.totals.deductions), icon: 'i-lucide-minus-circle', hint: t('hrPayroll.totals.gosiEmployeeHint', { amount: money(props.totals.gosi_employee) }) },
  { id: 'gosi-employer', label: t('hrPayroll.totals.gosiEmployer'), value: money(props.totals.gosi_employer), icon: 'i-lucide-landmark' },
])
</script>

<template>
  <SharedKpiStrip class="webvue-print-hide" :tiles="tiles" :loading="props.loading" :label="t('hrPayroll.totals.title')" data-testid="hr-payroll-totals" />
</template>
