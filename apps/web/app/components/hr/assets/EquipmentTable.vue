<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { RouteLocationRaw } from 'vue-router'
import type { HrEquipment } from '@webvue/contracts'
import RecordNumber from '@webvue/ui/app/components/shared/data/RecordNumber.vue'
import { recordNumberHeader } from '@webvue/ui/app/utils/recordNumberHeader'
import { formatDate } from '@webvue/ui/app/utils/formatDate'

// The equipment table of /hr/assets: one row per asset with its category, its holder and
// the state pill. It is a bare SharedDataTable inside the page's SharedListCard.
const props = defineProps<{
  equipment: HrEquipment[]
  rowTo: (row: HrEquipment) => RouteLocationRaw
  caption: string
  loading?: boolean
}>()

const { t } = useI18n()

const columns = computed<TableColumn<HrEquipment>[]>(() => [
  { accessorKey: 'id', header: () => recordNumberHeader(t), meta: { class: { th: 'w-[48px] min-w-[48px] px-2', td: 'w-[48px] min-w-[48px] px-2' } } },
  { accessorKey: 'name', header: t('hrAssets.columns.name') },
  { accessorKey: 'category', header: t('hrAssets.columns.category') },
  { accessorKey: 'employee', header: t('hrAssets.columns.employee') },
  { accessorKey: 'assign_date', header: t('hrAssets.columns.assignDate') },
  { accessorKey: 'active', header: t('hrAssets.columns.state'), meta: { class: { th: 'w-[110px]', td: 'w-[110px]' } } },
])

function holder(equipment: HrEquipment) {
  return equipment.employee?.name || t('hrAssets.unassigned')
}
</script>

<template>
  <SharedDataTable
    bare
    :rows="props.equipment"
    :columns="columns"
    row-key="id"
    :row-to="props.rowTo"
    :loading="props.loading"
    :caption="props.caption"
  >
    <template #id-cell="{ row }"><RecordNumber :value="row.original.id" :data-testid="`hr-asset-row-${row.original.id}`" /></template>
    <template #name-cell="{ row }">
      <span class="font-semibold text-highlighted">{{ row.original.name }}</span>
      <span v-if="row.original.serial_no" class="block text-xs text-muted"><bdi>{{ row.original.serial_no }}</bdi></span>
    </template>
    <template #category-cell="{ row }">{{ row.original.category?.name || t('hrAssets.noCategory') }}</template>
    <template #employee-cell="{ row }">
      <span :class="row.original.employee ? 'text-highlighted' : 'text-muted'">{{ holder(row.original) }}</span>
    </template>
    <template #assign_date-cell="{ row }">
      <span v-if="row.original.employee && row.original.assign_date" class="tabular-nums">{{ formatDate(row.original.assign_date) }}</span>
      <span v-else class="text-muted">—</span>
    </template>
    <template #active-cell="{ row }">
      <SharedStatusBadge
        size="sm"
        :tone="row.original.active ? 'success' : 'neutral'"
        :label="row.original.active ? t('hrAssets.state.active') : t('hrAssets.state.archived')"
        data-testid="hr-asset-state"
      />
    </template>
    <template #mobile-row="{ row }">
      <div class="flex items-center justify-between gap-2">
        <bdi class="text-xs text-muted">#{{ row.id }}</bdi>
        <SharedStatusBadge size="sm" :tone="row.active ? 'success' : 'neutral'" :label="row.active ? t('hrAssets.state.active') : t('hrAssets.state.archived')" />
      </div>
      <p class="mt-1 font-semibold text-highlighted">{{ row.name }}</p>
      <p class="mt-1 text-sm">{{ row.category?.name || t('hrAssets.noCategory') }} · {{ holder(row) }}</p>
    </template>
  </SharedDataTable>
</template>
