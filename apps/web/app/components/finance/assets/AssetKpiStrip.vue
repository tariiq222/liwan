<script setup lang="ts">
import { useFinanceAssetList } from '@/composables/finance/useFinanceAssets'
import { assetKpiParams, assetKpiTiles, type AssetKpiCounts, type AssetListFilters } from './assetListParams'

// The counts above the assets list: every figure is the total the server reports for the list's own filters
// (the state filter excepted: each tile picks its state), asked for with one row, never counted from the loaded page.
const props = defineProps<{ filters: AssetListFilters }>()
const { t } = useI18n()
const total = useFinanceAssetList(() => assetKpiParams(props.filters, null))
const draft = useFinanceAssetList(() => assetKpiParams(props.filters, 'draft'))
const running = useFinanceAssetList(() => assetKpiParams(props.filters, 'open'))
const closed = useFinanceAssetList(() => assetKpiParams(props.filters, 'close'))
const counts = computed<AssetKpiCounts>(() => ({
  total: total.data.value?.total,
  draft: draft.data.value?.total,
  open: running.data.value?.total,
  close: closed.data.value?.total,
}))
const tiles = computed(() => assetKpiTiles(counts.value, id => t(`financeAssets.kpi.${id}`)))
const loading = computed(() => Object.values(counts.value).some(count => count === undefined))
</script>

<template>
  <SharedKpiStrip :tiles="tiles" :loading="loading" :label="t('financeAssets.kpi.label')" data-testid="finance-asset-kpis" />
</template>
