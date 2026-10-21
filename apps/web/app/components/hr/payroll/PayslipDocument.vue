<script setup lang="ts">
import type { HrPayslip } from '@webvue/contracts'
import { formatPayrollAmount, formatPayrollMonth } from '@/utils/payrollFormat'

// One payslip as a document: the company and employee heading, the earnings and deductions the payroll engine
// produced, and the net. It is the content of a print page (black on white on paper); the page owns the data and the
// print and back actions, and the caller's own payslip page reuses it.
const props = defineProps<{ payslip: HrPayslip }>()

const { t, locale } = useI18n()
const amount = (value: number) => formatPayrollAmount(value, locale.value)
const money = (value: number) => `${amount(value)} ${t('hrPayroll.currency')}`

// The engine signs its lines: an earning is positive, a deduction negative.
const earnings = computed(() => props.payslip.lines.filter(line => line.amount > 0))
const deductions = computed(() => props.payslip.lines.filter(line => line.amount < 0))
const facts = computed(() => [
  { key: 'employee', label: t('hrPayroll.payslip.employee'), value: props.payslip.employee.name },
  { key: 'department', label: t('hrPayroll.payslip.department'), value: props.payslip.department?.name ?? '—' },
  { key: 'month', label: t('hrPayroll.payslip.month'), value: formatPayrollMonth(props.payslip.month, locale.value) },
  { key: 'paidDays', label: t('hrPayroll.payslip.paidDays'), value: String(props.payslip.paid_days), ltr: true },
])
</script>

<template>
  <div class="grid min-w-0 gap-4.5 print:gap-[8mm]" data-testid="hr-payslip-document">
    <header class="flex min-w-0 flex-wrap items-start justify-between gap-3 border-b-2 border-primary pb-3">
      <div>
        <p class="text-xl font-bold">{{ props.payslip.company.name }}</p>
        <p v-if="props.payslip.company.vat" class="text-sm text-muted">{{ t('hrPayroll.payslip.vat') }}: <bdi>{{ props.payslip.company.vat }}</bdi></p>
      </div>
      <div class="text-end">
        <p class="text-lg font-semibold">{{ t('hrPayroll.payslip.title') }}</p>
        <p v-if="props.payslip.number" class="text-sm text-muted">{{ t('hrPayroll.payslip.number') }}: <bdi>{{ props.payslip.number }}</bdi></p>
      </div>
    </header>

    <div class="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2.5">
      <div v-for="fact in facts" :key="fact.key" class="grid gap-0.5 rounded-control border border-default px-2.5 py-2">
        <span class="text-xs text-muted">{{ fact.label }}</span>
        <strong :dir="fact.ltr ? 'ltr' : undefined">{{ fact.value }}</strong>
      </div>
    </div>

    <div class="grid gap-4.5 md:grid-cols-2">
      <section class="grid content-start gap-2" :aria-label="t('hrPayroll.payslip.earnings')">
        <h2 class="text-sm font-semibold text-highlighted">{{ t('hrPayroll.payslip.earnings') }}</h2>
        <dl class="grid gap-1.5">
          <div v-for="line in earnings" :key="line.code" class="flex justify-between gap-3 border-b border-default pb-1.5" :data-testid="`hr-payslip-line-${line.code}`">
            <dt>{{ line.name }}</dt>
            <dd class="tabular-nums">{{ amount(line.amount) }}</dd>
          </div>
          <div class="flex justify-between gap-3 font-semibold text-highlighted">
            <dt>{{ t('hrPayroll.payslip.gross') }}</dt>
            <dd class="tabular-nums" data-testid="hr-payslip-gross">{{ amount(props.payslip.gross) }}</dd>
          </div>
        </dl>
      </section>
      <section class="grid content-start gap-2" :aria-label="t('hrPayroll.payslip.deductions')">
        <h2 class="text-sm font-semibold text-highlighted">{{ t('hrPayroll.payslip.deductions') }}</h2>
        <dl class="grid gap-1.5">
          <p v-if="deductions.length === 0" class="text-sm text-muted">{{ t('hrPayroll.payslip.noDeductions') }}</p>
          <div v-for="line in deductions" :key="line.code" class="flex justify-between gap-3 border-b border-default pb-1.5" :data-testid="`hr-payslip-line-${line.code}`">
            <dt>{{ line.name }}</dt>
            <dd class="tabular-nums">{{ amount(Math.abs(line.amount)) }}</dd>
          </div>
          <div class="flex justify-between gap-3 font-semibold text-highlighted">
            <dt>{{ t('hrPayroll.payslip.totalDeductions') }}</dt>
            <dd class="tabular-nums" data-testid="hr-payslip-deductions">{{ amount(props.payslip.deductions) }}</dd>
          </div>
        </dl>
      </section>
    </div>

    <div class="flex flex-wrap items-center justify-between gap-3 rounded-control border-2 border-default px-4 py-3">
      <span class="text-lg font-semibold">{{ t('hrPayroll.payslip.net') }}</span>
      <strong class="text-2xl tabular-nums" data-testid="hr-payslip-net">{{ money(props.payslip.net) }}</strong>
    </div>
    <p class="text-xs text-muted">{{ t('hrPayroll.payslip.gosiEmployerNote', { amount: money(props.payslip.gosi_employer) }) }}</p>

    <footer class="grid grid-cols-2 gap-7 pt-5">
      <div v-for="label in [t('hrPayroll.payslip.employeeSignature'), t('hrPayroll.payslip.accountantSignature')]" :key="label" class="grid gap-4.5">
        <span>{{ label }}</span>
        <span class="block min-h-7 border-b border-default" />
      </div>
    </footer>
  </div>
</template>
