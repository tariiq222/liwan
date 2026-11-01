<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { RouteLocationRaw } from 'vue-router'
import type { HrInsuranceEnrollment } from '@liwan/contracts'
import RecordNumber from '@liwan/ui/app/components/shared/data/RecordNumber.vue'
import { recordNumberHeader } from '@liwan/ui/app/utils/recordNumberHeader'
import { formatDate } from '@liwan/ui/app/utils/formatDate'
import { hrInsuranceEnrollmentBadge } from '@/utils/hrInsurance'

// The enrollment table of /hr/insurance: one row per employee membership with its plan, coverage dates,
// dependents and state pill. It is a bare SharedDataTable inside the page's SharedListCard.
const props = defineProps<{
  enrollments: HrInsuranceEnrollment[]
  rowTo: (row: HrInsuranceEnrollment) => RouteLocationRaw
  caption: string
  loading?: boolean
}>()

const { t } = useI18n()

const columns = computed<TableColumn<HrInsuranceEnrollment>[]>(() => [
  { accessorKey: 'id', header: () => recordNumberHeader(t), meta: { class: { th: 'w-[48px] min-w-[48px] px-2', td: 'w-[48px] min-w-[48px] px-2' } } },
  { accessorKey: 'employee', header: t('hrInsurance.columns.employee') },
  { accessorKey: 'plan', header: t('hrInsurance.columns.plan') },
  { accessorKey: 'date_from', header: t('hrInsurance.columns.coverage') },
  { accessorKey: 'dependents_count', header: t('hrInsurance.columns.dependents'), meta: { class: { th: 'w-[110px]', td: 'w-[110px]' } } },
  { accessorKey: 'state', header: t('hrInsurance.columns.state'), meta: { class: { th: 'w-[130px]', td: 'w-[130px]' } } },
])

function badge(row: HrInsuranceEnrollment) {
  const entry = hrInsuranceEnrollmentBadge(row.state)
  return { tone: entry.tone, label: t(entry.labelKey) }
}
</script>

<template>
  <SharedDataTable
    bare
    :rows="props.enrollments"
    :columns="columns"
    row-key="id"
    :row-to="props.rowTo"
    :loading="props.loading"
    :caption="props.caption"
  >
    <template #id-cell="{ row }"><RecordNumber :value="row.original.id" :data-testid="`hr-insurance-enrollment-row-${row.original.id}`" /></template>
    <template #employee-cell="{ row }"><span class="font-semibold text-highlighted">{{ row.original.employee.name }}</span></template>
    <template #plan-cell="{ row }">
      {{ row.original.plan.name }}
      <span class="block text-xs text-muted">{{ row.original.plan.provider.name }}<template v-if="row.original.plan.tier"> · {{ row.original.plan.tier }}</template></span>
    </template>
    <template #date_from-cell="{ row }">
      <span class="tabular-nums">{{ formatDate(row.original.date_from) }} – {{ formatDate(row.original.date_end) }}</span>
      <span v-if="row.original.date_to === null" class="block text-xs text-muted">{{ t('hrInsurance.untilPlanEnd') }}</span>
    </template>
    <template #dependents_count-cell="{ row }"><span class="tabular-nums">{{ row.original.dependents_count }}</span></template>
    <template #state-cell="{ row }">
      <SharedStatusBadge size="sm" :tone="badge(row.original).tone" :label="badge(row.original).label" data-testid="hr-insurance-enrollment-state" />
    </template>
    <template #mobile-row="{ row }">
      <div class="flex items-center justify-between gap-2">
        <bdi class="text-xs text-muted">#{{ row.id }}</bdi>
        <SharedStatusBadge size="sm" :tone="badge(row).tone" :label="badge(row).label" />
      </div>
      <p class="mt-1 font-semibold text-highlighted">{{ row.employee.name }}</p>
      <p class="mt-1 text-sm">{{ row.plan.name }} · {{ formatDate(row.date_from) }} – {{ formatDate(row.date_end) }}</p>
    </template>
  </SharedDataTable>
</template>
