<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { FinanceAssetProfile } from '@liwan/contracts'
import type { RowAction } from '@liwan/ui/app/components/shared/data/RowActions.vue'
import { returnToQuery } from '@liwan/ui/app/utils/safeReturnTo'
import { h } from 'vue'
import { useArchiveSetupAssetProfile, useSetupAssetProfiles } from '@/composables/finance/useFinanceRecords'
import RecordArchiveConfirm from './RecordArchiveConfirm.vue'
import RecordsFilters from './RecordsFilters.vue'
import { useRecordList } from './useRecordList'

// The depreciation profiles of fixed assets: method, accounts and journal. No search or kind (the API has neither); an archived
// profile cannot be chosen for a new asset, and the assets that use it keep running.
const props = defineProps<{ background?: boolean }>()
const { t } = useI18n()
const { can } = useAccess()
const route = useRoute()
const canManage = computed(() => can('finance.assets.manage'))
const list = useRecordList<FinanceAssetProfile>({ fallbackPath: '/settings/apps/finance/asset-profiles', background: () => props.background, searchable: false, list: params => useSetupAssetProfiles(params) })
const { mutateAsync: send, isPending: archiving } = useArchiveSetupAssetProfile()

const archivingItem = ref<FinanceAssetProfile | null>(null)

const columns = computed<TableColumn<FinanceAssetProfile>[]>(() => [
  { id: 'name', header: t('financeRecords.assetProfiles.columns.name') },
  { id: 'method', header: t('financeRecords.assetProfiles.columns.method') },
  { id: 'duration', header: t('financeRecords.assetProfiles.columns.duration') },
  { id: 'accounts', header: t('financeRecords.assetProfiles.columns.accounts') },
  { id: 'state', header: t('financeRecords.columns.state') },
  ...(canManage.value ? [{ id: 'actions', header: () => h('span', { class: 'sr-only' }, t('app.actions')), meta: { class: { th: 'w-0', td: 'w-0 text-end' } } }] : []),
])
const methodLabel = (profile: FinanceAssetProfile) => t(`financeRecords.assetProfiles.methodsAll.${profile.method}`)
const durationLabel = (profile: FinanceAssetProfile) => t(`financeRecords.assetProfiles.duration.${profile.method_time}`, { count: profile.method_number, period: t(`financeRecords.assetProfiles.periods.${profile.method_period}`) }, profile.method_number)
const stateTone = (profile: FinanceAssetProfile) => profile.active ? 'success' : 'neutral'
const stateLabel = (profile: FinanceAssetProfile) => t(`financeRecords.states.${profile.active ? 'active' : 'archived'}`)
const actions = (profile: FinanceAssetProfile): RowAction[] => [
  { label: t('financeRecords.actions.edit'), icon: 'i-lucide-pencil', to: { path: `/settings/apps/finance/asset-profiles/${profile.id}/edit`, query: returnToQuery(route.fullPath) } },
  { label: t(`financeRecords.actions.${profile.active ? 'archive' : 'unarchive'}`), icon: profile.active ? 'i-lucide-archive' : 'i-lucide-archive-restore', onSelect: () => { archivingItem.value = profile } },
]
</script>

<template>
  <div class="grid gap-(--liwan-gap-card)">
    <RecordArchiveConfirm
      v-if="archivingItem"
      :key="archivingItem.id"
      scope="assetProfiles"
      :name="archivingItem.name"
      :active="archivingItem.active"
      :pending="archiving"
      :send="archive => send({ id: archivingItem!.id, archive })"
      @done="archivingItem = null"
      @cancel="archivingItem = null"
    />
    <SharedListCard data-testid="finance-record-asset-profiles">
      <template #filters>
        <RecordsFilters id-prefix="finance-record-asset-profiles" :filters="list.filters.value" :active-count="list.activeCount.value" :hydrated="list.hydrated.value" @clear="list.clearFilters" @kind="list.setKind" @state="list.setState" />
      </template>
      <SharedPageState :error="list.query.error.value" :keep-content="list.items.value.length > 0" @retry="list.query.refetch">
        <SharedEmptyState v-if="list.showEmpty.value" :icon="list.activeCount.value ? 'i-lucide-filter-x' : 'i-lucide-layers'" class="m-(--liwan-card-pad-dense)" :title="t(list.activeCount.value ? 'app.noResults' : 'financeRecords.assetProfiles.empty')" />
        <div v-else class="min-w-0 [&_table]:w-full [&_table]:min-w-[max(100%,640px)]">
          <SharedDataTable bare :rows="list.items.value" :columns="columns" row-key="id" :loading="list.query.isPending.value" :caption="t('financeRecords.assetProfiles.title')">
            <template #name-cell="{ row }"><span class="font-semibold text-highlighted">{{ row.original.name }}</span></template>
            <template #method-cell="{ row }">{{ methodLabel(row.original) }}</template>
            <template #duration-cell="{ row }">{{ durationLabel(row.original) }}</template>
            <template #accounts-cell="{ row }"><span class="text-sm">{{ row.original.asset_account.name }} · {{ row.original.depreciation_account.name }}</span></template>
            <template #state-cell="{ row }"><SharedStatusBadge size="sm" :tone="stateTone(row.original)" :label="stateLabel(row.original)" /></template>
            <template #actions-cell="{ row }">
              <SharedRowActions :actions="actions(row.original)" :label="t('financeRecords.assetProfiles.actionsNamed', { name: row.original.name })" :disabled="!list.hydrated.value || archivingItem !== null" />
            </template>
            <template #mobile-row="{ row }">
              <div class="flex min-w-0 items-start justify-between gap-2" :data-testid="`finance-record-asset-profile-${row.id}`">
                <div class="flex min-w-0 flex-col gap-1">
                  <span class="truncate font-semibold text-highlighted">{{ row.name }}</span>
                  <span class="text-sm text-muted">{{ methodLabel(row) }} · {{ durationLabel(row) }}</span>
                  <SharedStatusBadge size="sm" class="w-fit" :tone="stateTone(row)" :label="stateLabel(row)" />
                </div>
                <SharedRowActions v-if="canManage" :actions="actions(row)" :label="t('financeRecords.assetProfiles.actionsNamed', { name: row.name })" :disabled="!list.hydrated.value || archivingItem !== null" />
              </div>
            </template>
          </SharedDataTable>
        </div>
      </SharedPageState>
      <template v-if="list.query.data.value && !list.showEmpty.value" #footer>
        <SharedListFooter :count-label="t('financeRecords.assetProfiles.footer', { shown: list.items.value.length, total: list.total.value }, list.total.value)" :page="list.filters.value.page" :pages="list.pages.value" :disabled="!list.hydrated.value || list.query.isFetching.value" count-test-id="finance-record-asset-profile-count" @update:page="list.setPage" />
      </template>
    </SharedListCard>
  </div>
</template>
