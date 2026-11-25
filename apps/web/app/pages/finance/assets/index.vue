<script setup lang="ts">
import AssetComputeButton from '@/components/finance/assets/AssetComputeButton.vue'
import AssetList from '@/components/finance/assets/AssetList.vue'
import { useAssetCompute } from '@/components/finance/assets/useAssetCompute'
import { useAssetListPage } from '@/components/finance/assets/useAssetListPage'

const page = useAssetListPage()
const compute = useAssetCompute()
</script>

<template>
  <SharedListPage v-bind="page.header">
    <template v-if="page.allowed" #kpis>
      <SharedKpiStrip v-if="page.kpis.shown && !page.kpis.error" :tiles="page.kpis.tiles" :loading="page.kpis.loading" :label="page.kpis.label" data-testid="finance-asset-kpis" />
    </template>
    <template v-if="compute.allowed" #actions><AssetComputeButton :compute="compute" /></template>
    <AssetList :compute="compute" />
  </SharedListPage>
</template>
