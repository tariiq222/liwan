<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { HrPayrollCostCenter } from '@webvue/contracts'
import { NO_RECORD } from '@/utils/payrollFinanceSettings'

// The cost center each department's payroll cost is charged to. A choice is saved at once; only the row being saved
// waits. Without `canEdit`, or without the right to read analytic accounts, the table is read-only.
const props = defineProps<{
  centers: HrPayrollCostCenter[]
  /** The analytic accounts to choose from; null when the user cannot read them. */
  analyticAccounts: { id: number; name: string; code?: string }[] | null
  canEdit: boolean
  /** The departments whose choice is being saved. */
  saving: number[]
}>()
const emit = defineEmits<{ change: [payload: { departmentId: number; analyticAccountId: number | null }] }>()

const { t } = useI18n()
const hydrated = useHydrated()

const columns = computed<TableColumn<HrPayrollCostCenter>[]>(() => [
  { id: 'department', header: t('hrPayroll.costCenters.department') },
  { id: 'analytic', header: t('hrPayroll.costCenters.analytic') },
])
const editable = computed(() => props.canEdit && props.analyticAccounts !== null)
const items = computed(() => [
  { value: NO_RECORD, label: t('hrPayroll.costCenters.none') },
  ...(props.analyticAccounts ?? []).map(account => ({ value: String(account.id), label: account.code ? `${account.code} ${account.name}` : account.name })),
])
const select = (center: HrPayrollCostCenter, value: unknown) => emit('change', {
  departmentId: center.department.id,
  analyticAccountId: value === NO_RECORD ? null : Number(value),
})
</script>

<template>
  <SharedDataTable
    :rows="props.centers"
    :columns="columns"
    :row-key="(row: HrPayrollCostCenter) => row.department.id"
    :empty-text="t('hrPayroll.costCenters.empty')"
    :caption="t('hrPayroll.costCenters.title')"
  >
    <template #department-cell="{ row }">{{ row.original.department.name }}</template>
    <template #analytic-cell="{ row }">
      <USelect
        v-if="editable"
        class="w-full min-w-48"
        :model-value="row.original.analytic_account ? String(row.original.analytic_account.id) : NO_RECORD"
        :items="items"
        :disabled="!hydrated || props.saving.includes(row.original.department.id)"
        :aria-label="t('hrPayroll.costCenters.analytic')"
        :data-testid="`hr-payroll-cost-center-${row.original.department.id}`"
        @update:model-value="select(row.original, $event)"
      />
      <span v-else>{{ row.original.analytic_account?.name ?? t('hrPayroll.costCenters.none') }}</span>
    </template>
    <template #mobile-row="{ row }">
      <p class="font-semibold text-highlighted">{{ row.department.name }}</p>
      <USelect
        v-if="editable"
        class="mt-2 w-full"
        :model-value="row.analytic_account ? String(row.analytic_account.id) : NO_RECORD"
        :items="items"
        :disabled="!hydrated || props.saving.includes(row.department.id)"
        :aria-label="t('hrPayroll.costCenters.analytic')"
        @update:model-value="select(row, $event)"
      />
      <p v-else class="text-sm text-muted">{{ row.analytic_account?.name ?? t('hrPayroll.costCenters.none') }}</p>
    </template>
  </SharedDataTable>
</template>
