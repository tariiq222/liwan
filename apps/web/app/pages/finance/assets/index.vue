<script setup lang="ts">
import AssetComputeButton from '@/components/finance/assets/AssetComputeButton.vue'
import AssetList from '@/components/finance/assets/AssetList.vue'
import { useAssetCompute } from '@/components/finance/assets/useAssetCompute'
import { useAssetListPage } from '@/components/finance/assets/useAssetListPage'

const page = useAssetListPage()
const compute = useAssetCompute()
</script>

<template>
  <SharedListPage v-bind="page">
    <template v-if="compute.allowed" #actions><AssetComputeButton :compute="compute" /></template>
    <AssetList :compute="compute" />
  </SharedListPage>
</template>
