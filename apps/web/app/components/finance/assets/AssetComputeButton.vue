<script setup lang="ts">
import type { AssetComputeState } from './useAssetCompute'

// The header action of the assets list that opens the depreciation posting.
defineProps<{ compute: AssetComputeState }>()
const { t } = useI18n()
</script>

<template>
  <UButton v-if="compute.allowed" color="neutral" variant="outline" icon="i-lucide-calculator" :disabled="!compute.hydrated || compute.open" :label="t('financeAssets.compute.action')" data-testid="finance-asset-compute" @click="compute.start()" />
</template>
