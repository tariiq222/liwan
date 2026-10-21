<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { FinanceAssetProfile } from '@webvue/contracts'
import type { RowAction } from '@webvue/ui/app/components/shared/data/RowActions.vue'
import { h } from 'vue'
import { useArchiveSetupAssetProfile, useSetupAssetProfiles } from '@/composables/finance/useFinanceRecords'
import AssetProfileEditor from './AssetProfileEditor.vue'
import RecordArchiveConfirm from './RecordArchiveConfirm.vue'
import RecordsFilters from './RecordsFilters.vue'
import { useRecordList } from './useRecordList'

// The depreciation profiles of fixed assets: method, accounts and journal. No search or kind (the API has neither); an archived
// profile cannot be chosen for a new asset, and the assets that use it keep running.
const { t } = useI18n()
const { can } = useAccess()
const canManage = computed(() => can('finance.assets.manage'))
const list = useRecordList<FinanceAssetProfile>({ fallbackPath: '/settings/apps/finance/asset-profiles', searchable: false, list: params => useSetupAssetProfiles(params) })
const { mutateAsync: send, isPending: archiving } = useArchiveSetupAssetProfile()

type Panel = { kind: 'create' } | { kind: 'edit' | 'archive'; profile: FinanceAssetProfile }
const panel = ref<Panel | null>(null)
const panelKey = (value: Panel) => value.kind === 'create' ? 'create' : `${value.kind}-${value.profile.id}`

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
  { label: t('financeRecords.actions.edit'), icon: 'i-lucide-pencil', onSelect: () => { panel.value = { kind: 'edit', profile } } },
  { label: t(`financeRecords.actions.${profile.active ? 'archive' : 'unarchive'}`), icon: profile.active ? 'i-lucide-archive' : 'i-lucide-archive-restore', onSelect: () => { panel.value = { kind: 'archive', profile } } },
]
</script>

<template>
  <SharedRecordSection variant="panel" :title="t('financeRecords.assetProfiles.title')" :description="t('financeRecords.assetProfiles.description')" data-testid="finance-record-asset-profiles">
    <template v-if="canManage" #actions>
      <UButton color="primary" icon="i-lucide-plus" :disabled="!list.hydrated.value || panel !== null" :label="t('financeRecords.assetProfiles.new')" data-testid="finance-record-asset-profile-new" @click="panel = { kind: 'create' }" />
    </template>
    <div class="grid gap-(--webvue-gap-card)">
      <template v-if="panel">
        <RecordArchiveConfirm v-if="panel.kind === 'archive'" :key="panelKey(panel)" scope="assetProfiles" :name="panel.profile.name" :active="panel.profile.active" :pending="archiving" :send="archive => send({ id: (panel as { profile: FinanceAssetProfile }).profile.id, archive })" @done="panel = null" @cancel="panel = null" />
        <AssetProfileEditor v-else :key="panelKey(panel)" :profile="panel.kind === 'edit' ? panel.profile : undefined" @done="panel = null" @cancel="panel = null" />
      </template>
      <RecordsFilters id-prefix="finance-record-asset-profiles" :filters="list.filters.value" :active-count="list.activeCount.value" :hydrated="list.hydrated.value" @clear="list.clearFilters" @kind="list.setKind" @state="list.setState" />
      <SharedPageState :error="list.query.error.value" :keep-content="list.items.value.length > 0" @retry="list.query.refetch">
        <SharedEmptyState v-if="list.showEmpty.value" :title="t(list.activeCount.value ? 'app.noResults' : 'financeRecords.assetProfiles.empty')" />
        <div v-else class="min-w-0 [&_table]:w-full [&_table]:min-w-[max(100%,640px)]">
          <SharedDataTable bare :rows="list.items.value" :columns="columns" row-key="id" :loading="list.query.isPending.value" :caption="t('financeRecords.assetProfiles.title')">
            <template #name-cell="{ row }"><span class="font-semibold text-highlighted">{{ row.original.name }}</span></template>
            <template #method-cell="{ row }">{{ methodLabel(row.original) }}</template>
            <template #duration-cell="{ row }">{{ durationLabel(row.original) }}</template>
            <template #accounts-cell="{ row }"><span class="text-sm">{{ row.original.asset_account.name }} · {{ row.original.depreciation_account.name }}</span></template>
            <template #state-cell="{ row }"><SharedStatusBadge size="sm" :tone="stateTone(row.original)" :label="stateLabel(row.original)" /></template>
            <template #actions-cell="{ row }">
              <SharedRowActions :actions="actions(row.original)" :label="t('financeRecords.assetProfiles.actionsNamed', { name: row.original.name })" :disabled="!list.hydrated.value || panel !== null" />
            </template>
            <template #mobile-row="{ row }">
              <div class="flex min-w-0 items-start justify-between gap-2" :data-testid="`finance-record-asset-profile-${row.id}`">
                <div class="flex min-w-0 flex-col gap-1">
                  <span class="truncate font-semibold text-highlighted">{{ row.name }}</span>
                  <span class="text-sm text-muted">{{ methodLabel(row) }} · {{ durationLabel(row) }}</span>
                  <SharedStatusBadge size="sm" class="w-fit" :tone="stateTone(row)" :label="stateLabel(row)" />
                </div>
                <SharedRowActions v-if="canManage" :actions="actions(row)" :label="t('financeRecords.assetProfiles.actionsNamed', { name: row.name })" :disabled="!list.hydrated.value || panel !== null" />
              </div>
            </template>
          </SharedDataTable>
        </div>
      </SharedPageState>
      <SharedListFooter v-if="list.query.data.value && !list.showEmpty.value" :count-label="t('financeRecords.assetProfiles.footer', { shown: list.items.value.length, total: list.total.value }, list.total.value)" :page="list.filters.value.page" :pages="list.pages.value" :disabled="!list.hydrated.value || list.query.isFetching.value" count-test-id="finance-record-asset-profile-count" @update:page="list.setPage" />
    </div>
  </SharedRecordSection>
</template>
