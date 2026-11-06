<script setup lang="ts">
import { useFinanceAssetSummary } from '@/composables/finance/useFinanceKpis'
import { assetSummaryParams, assetKpiTiles, type AssetKpiCounts, type AssetListFilters } from './assetListParams'

const props = defineProps<{ filters: AssetListFilters }>()
const { t } = useI18n()
const summary = useFinanceAssetSummary(() => assetSummaryParams(props.filters))
const counts = computed<AssetKpiCounts>(() => ({
  total: summary.data.value?.total,
  draft: summary.data.value?.draft,
  open: summary.data.value?.open,
  close: summary.data.value?.close,
}))
const tiles = computed(() => assetKpiTiles(counts.value, id => t(`financeAssets.kpi.${id}`)))
const loading = computed(() => summary.data.value === undefined)
</script>

<template>
  <SharedKpiStrip :tiles="tiles" :loading="loading" :label="t('financeAssets.kpi.label')" data-testid="finance-asset-kpis" />
</template>
