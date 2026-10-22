<script setup lang="ts">
definePageMeta({ path: '/account/assets' })
import type { TableColumn } from '@nuxt/ui'
import type { HrEquipment } from '@webvue/contracts'
import { formatDate } from '@webvue/ui/app/utils/formatDate'

// Own custody remains read-only and never links into administrative asset records.
const { t } = useI18n()

const profile = useMyHrProfile()
const mine = useMyHrAssets(computed(() => !!profile.data.value))
const items = computed(() => mine.data.value?.items ?? [])
const showEmpty = computed(() => !mine.isLoading.value && !mine.error.value && items.value.length === 0)

const columns = computed<TableColumn<HrEquipment>[]>(() => [
  { accessorKey: 'name', header: t('hrAssets.columns.name') },
  { accessorKey: 'category', header: t('hrAssets.columns.category') },
  { accessorKey: 'assign_date', header: t('hrAssets.columns.assignDate') },
])

</script>

<template>
  <SharedListPage :title="t('nav.myAssets')">
    <SharedPageState :loading="profile.isLoading.value" :error="profile.error.value" @retry="profile.refetch">
      <SharedEmptyState v-if="profile.data.value === null" bordered :title="t('hr.self.noEmployee')" :description="t('hr.self.noEmployeeHint')" />
    </SharedPageState>
    <SharedListCard v-if="profile.data.value">
      <SharedPageState :error="mine.error.value" :keep-content="items.length > 0" @retry="mine.refetch">
        <SharedEmptyState v-if="showEmpty" class="m-(--webvue-card-pad-dense)" :title="t('hrAssets.mine.emptyTitle')" :description="t('hrAssets.mine.emptyHint')" />
        <SharedDataTable
          v-else
          bare
          :rows="items"
          :columns="columns"
          row-key="id"
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
