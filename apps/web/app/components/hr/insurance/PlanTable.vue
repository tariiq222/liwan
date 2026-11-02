<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { RouteLocationRaw } from 'vue-router'
import type { HrInsurancePlan } from '@liwan/contracts'
import RecordNumber from '@liwan/ui/app/components/shared/data/RecordNumber.vue'
import { recordNumberHeader } from '@liwan/ui/app/utils/recordNumberHeader'
import { formatDate } from '@liwan/ui/app/utils/formatDate'
import { hrInsurancePlanBadge, isHrInsurancePlanExpiring } from '@/utils/hrInsurance'

// The plan table of /hr/insurance: one row per policy with its provider, tier, validity and the days left.
// `alertDays` is the company's expiry alert window; a running plan inside it is flagged.
const props = defineProps<{
  plans: HrInsurancePlan[]
  rowTo: (row: HrInsurancePlan) => RouteLocationRaw
  caption: string
  alertDays: number
  loading?: boolean
}>()

const { t } = useI18n()

const columns = computed<TableColumn<HrInsurancePlan>[]>(() => [
  { accessorKey: 'id', header: () => recordNumberHeader(t), meta: { class: { th: 'w-[48px] min-w-[48px] px-2', td: 'w-[48px] min-w-[48px] px-2' } } },
  { accessorKey: 'name', header: t('hrInsurance.columns.plan') },
  { accessorKey: 'provider', header: t('hrInsurance.columns.provider') },
  { accessorKey: 'valid_from', header: t('hrInsurance.columns.validity') },
  { accessorKey: 'state', header: t('hrInsurance.columns.state'), meta: { class: { th: 'w-[170px]', td: 'w-[170px]' } } },
])

function badge(plan: HrInsurancePlan) {
  const entry = hrInsurancePlanBadge(plan.state)
  return { tone: entry.tone, label: t(entry.labelKey) }
}
function remaining(plan: HrInsurancePlan) {
  return plan.state === 'active' && plan.expires_in_days !== null ? t('hrInsurance.expiresIn', { days: plan.expires_in_days }, plan.expires_in_days) : ''
}
</script>

<template>
  <SharedDataTable
    bare
    :rows="props.plans"
    :columns="columns"
    row-key="id"
    :row-to="props.rowTo"
    :loading="props.loading"
    :caption="props.caption"
  >
    <template #id-cell="{ row }"><RecordNumber :value="row.original.id" :data-testid="`hr-insurance-plan-row-${row.original.id}`" /></template>
    <template #name-cell="{ row }">
      <span class="font-semibold text-highlighted">{{ row.original.name }}</span>
      <span v-if="row.original.tier" class="block text-xs text-muted">{{ row.original.tier }}</span>
    </template>
    <template #provider-cell="{ row }">{{ row.original.provider.name }}</template>
    <template #valid_from-cell="{ row }"><span class="tabular-nums">{{ formatDate(row.original.valid_from) }} – {{ formatDate(row.original.valid_to) }}</span></template>
    <template #state-cell="{ row }">
      <SharedStatusBadge size="sm" :tone="badge(row.original).tone" :label="badge(row.original).label" data-testid="hr-insurance-plan-state" />
      <span v-if="remaining(row.original)" class="block text-xs" :class="isHrInsurancePlanExpiring(row.original, props.alertDays) ? 'text-warning' : 'text-muted'">{{ remaining(row.original) }}</span>
    </template>
    <template #mobile-row="{ row }">
      <div class="flex items-center justify-between gap-2">
        <bdi class="text-xs text-muted">#{{ row.id }}</bdi>
        <SharedStatusBadge size="sm" :tone="badge(row).tone" :label="badge(row).label" />
      </div>
      <p class="mt-1 font-semibold text-highlighted">{{ row.name }}</p>
      <p class="mt-1 text-sm">{{ row.provider.name }} · {{ formatDate(row.valid_from) }} – {{ formatDate(row.valid_to) }}</p>
      <p v-if="remaining(row)" class="text-xs text-muted">{{ remaining(row) }}</p>
    </template>
  </SharedDataTable>
</template>
