<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { RouteLocationRaw } from 'vue-router'
import type { HrPayrollTotals, HrPayslipInputs, HrPayslipInputsPatch, HrPayslipRow } from '@webvue/contracts'
import { parseMoneyInput } from '@/utils/moneyInput'
import { formatPayrollAmount } from '@/utils/payrollFormat'

// The payslip register of one payroll run: a row per employee with the five monthly inputs and the computed
// figures. With `editable` the input cells are number fields that save on change (the page owns the request and the
// server's row replaces the edited one); otherwise they are read-only. The footer is the totals row, which prints.
const props = defineProps<{
  rows: HrPayslipRow[]
  rowTo: (row: HrPayslipRow) => RouteLocationRaw
  totals: HrPayrollTotals
  caption: string
  editable?: boolean
  /** The cells whose save is in flight, as `<payslip id>:<input name>`: only those wait for the server. */
  saving?: readonly string[]
  loading?: boolean
}>()
const emit = defineEmits<{ save: [payload: { payslipId: number; body: HrPayslipInputsPatch }] }>()

const { t, locale } = useI18n()
const hydrated = useHydrated()

// The inputs, in the order the register and the payslip show them.
const INPUT_FIELDS = ['overtime_amount', 'absence_days', 'bonus_amount', 'deduction_amount', 'advance_recovery_amount'] as const satisfies readonly (keyof HrPayslipInputs)[]
type InputField = typeof INPUT_FIELDS[number]

const columns = computed<TableColumn<HrPayslipRow>[]>(() => [
  { id: 'employee', header: t('hrPayroll.register.columns.employee') },
  { accessorKey: 'paid_days', header: t('hrPayroll.register.columns.paidDays') },
  ...INPUT_FIELDS.map(field => ({ id: field, header: t(`hrPayroll.register.inputs.${field}`) })),
  { id: 'gross', header: t('hrPayroll.register.columns.gross') },
  { id: 'deductions', header: t('hrPayroll.register.columns.deductions') },
  { id: 'net', header: t('hrPayroll.register.columns.net') },
])

const amount = (value: number) => formatPayrollAmount(value, locale.value)

// What the user typed in a cell and the server has not confirmed yet, by `<payslip id>:<field>`.
const drafts = reactive<Record<string, string>>({})
const invalid = reactive<Record<string, boolean>>({})
const cellKey = (row: HrPayslipRow, field: InputField) => `${row.id}:${field}`
const cellText = (row: HrPayslipRow, field: InputField) => drafts[cellKey(row, field)] ?? String(row.inputs[field])

function edit(row: HrPayslipRow, field: InputField, text: string) {
  drafts[cellKey(row, field)] = text
  delete invalid[cellKey(row, field)]
}

function commit(row: HrPayslipRow, field: InputField) {
  const key = cellKey(row, field)
  const text = drafts[key]
  if (text === undefined) return
  const parsed = parseMoneyInput(text, 2)
  if (!parsed.ok) { invalid[key] = true; return }
  if (parsed.value === row.inputs[field]) { delete drafts[key]; return }
  emit('save', { payslipId: row.id, body: { [field]: parsed.value } })
}

// The server's row is the truth: a draft that now equals it is done, and a refused one stays for the user to fix.
watch(() => props.rows, (rows) => {
  for (const row of rows) {
    for (const field of INPUT_FIELDS) {
      const key = cellKey(row, field)
      const parsed = key in drafts ? parseMoneyInput(drafts[key]!, 2) : null
      if (parsed?.ok && parsed.value === row.inputs[field]) delete drafts[key]
    }
  }
})
</script>

<template>
  <SharedDataTable
    bare
    :rows="props.rows"
    :columns="columns"
    row-key="id"
    :loading="props.loading"
    :caption="props.caption"
  >
    <template #employee-cell="{ row }">
      <NuxtLink :to="props.rowTo(row.original)" class="font-semibold text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" :data-testid="`hr-payroll-payslip-${row.original.id}`">{{ row.original.employee.name }}</NuxtLink>
      <span v-if="row.original.department" class="block text-xs text-muted">{{ row.original.department.name }}</span>
      <SharedStatusBadge v-if="row.original.iban_missing" class="mt-1" size="sm" tone="warning" :label="t('hrPayroll.register.ibanMissing')" />
    </template>
    <template #paid_days-cell="{ row }"><span class="tabular-nums">{{ row.original.paid_days }}</span></template>
    <template v-for="field in INPUT_FIELDS" :key="field" #[`${field}-cell`]="{ row }">
      <UInput
        v-if="props.editable"
        :model-value="cellText(row.original, field)"
        class="w-24"
        size="sm"
        dir="ltr"
        inputmode="decimal"
        :aria-label="`${row.original.employee.name}: ${t(`hrPayroll.register.inputs.${field}`)}`"
        :aria-invalid="invalid[cellKey(row.original, field)] || undefined"
        :color="invalid[cellKey(row.original, field)] ? 'error' : undefined"
        :disabled="!hydrated || props.saving?.includes(cellKey(row.original, field))"
        :data-testid="`hr-payroll-input-${row.original.id}-${field}`"
        @update:model-value="edit(row.original, field, String($event ?? ''))"
        @change="commit(row.original, field)"
      />
      <span v-else class="tabular-nums">{{ amount(row.original.inputs[field]) }}</span>
    </template>
    <template #gross-cell="{ row }"><span class="tabular-nums">{{ amount(row.original.gross) }}</span></template>
    <template #deductions-cell="{ row }"><span class="tabular-nums">{{ amount(row.original.deductions) }}</span></template>
    <template #net-cell="{ row }"><span class="font-semibold tabular-nums text-highlighted">{{ amount(row.original.net) }}</span></template>
    <template #footer>
      <dl class="flex w-full flex-wrap items-center justify-end gap-x-6 gap-y-1" data-testid="hr-payroll-register-totals">
        <div class="flex gap-2"><dt>{{ t('hrPayroll.register.columns.gross') }}</dt><dd class="tabular-nums text-highlighted">{{ amount(props.totals.gross) }}</dd></div>
        <div class="flex gap-2"><dt>{{ t('hrPayroll.register.columns.deductions') }}</dt><dd class="tabular-nums text-highlighted">{{ amount(props.totals.deductions) }}</dd></div>
        <div class="flex gap-2"><dt>{{ t('hrPayroll.register.columns.net') }}</dt><dd class="font-semibold tabular-nums text-highlighted">{{ amount(props.totals.net) }}</dd></div>
      </dl>
    </template>
  </SharedDataTable>
</template>
