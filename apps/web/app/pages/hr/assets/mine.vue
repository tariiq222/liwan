<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { HrEquipment } from '@webvue/contracts'
import { formatDate } from '@webvue/ui/app/utils/formatDate'
import { returnToQuery } from '@webvue/ui/app/utils/safeReturnTo'

// The caller's own custody, read-only: the holder sees what they were handed, never cost or
// vendor. A row opens the asset record only for a caller who may read the assets area.
const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()

const mine = useMyHrAssets()
const items = computed(() => mine.data.value?.items ?? [])
const showEmpty = computed(() => !mine.isLoading.value && !mine.error.value && items.value.length === 0)
const canOpen = computed(() => can('hr.assets.read'))

const columns = computed<TableColumn<HrEquipment>[]>(() => [
  { accessorKey: 'name', header: t('hrAssets.columns.name') },
  { accessorKey: 'category', header: t('hrAssets.columns.category') },
  { accessorKey: 'assign_date', header: t('hrAssets.columns.assignDate') },
])

function equipmentTo(row: HrEquipment) {
  return { path: `/hr/assets/${row.id}`, query: returnToQuery(route.fullPath) }
}
</script>

<template>
  <SharedListPage :title="t('nav.myAssets')" :description="t('hrAssets.mine.description')">
    <SharedListCard>
      <SharedPageState :error="mine.error.value" :keep-content="items.length > 0" @retry="mine.refetch">
        <SharedEmptyState v-if="showEmpty" class="m-(--webvue-card-pad-dense)" :title="t('hrAssets.mine.emptyTitle')" :description="t('hrAssets.mine.emptyHint')" />
        <SharedDataTable
          v-else
          bare
          :rows="items"
          :columns="columns"
          row-key="id"
          :row-to="canOpen ? equipmentTo : undefined"
          :loading="mine.isLoading.value"
          :caption="t('nav.myAssets')"
          data-testid="hr-my-assets-table"
        >
          <template #name-cell="{ row }">
            <span class="font-semibold text-highlighted">{{ row.original.name }}</span>
            <span v-if="row.original.serial_no" class="block text-xs text-muted"><bdi>{{ row.original.serial_no }}</bdi></span>
          </template>
          <template #category-cell="{ row }">{{ row.original.category?.name || t('hrAssets.noCategory') }}</template>
          <template #assign_date-cell="{ row }">
            <span v-if="row.original.assign_date" class="tabular-nums">{{ formatDate(row.original.assign_date) }}</span>
            <span v-else class="text-muted">—</span>
          </template>
          <template #mobile-row="{ row }">
            <p class="font-semibold text-highlighted">{{ row.name }}</p>
            <p v-if="row.serial_no" class="text-xs text-muted"><bdi>{{ row.serial_no }}</bdi></p>
            <p class="mt-1 text-sm">{{ row.category?.name || t('hrAssets.noCategory') }}<template v-if="row.assign_date"> · {{ formatDate(row.assign_date) }}</template></p>
          </template>
        </SharedDataTable>
      </SharedPageState>
    </SharedListCard>
  </SharedListPage>
</template>
