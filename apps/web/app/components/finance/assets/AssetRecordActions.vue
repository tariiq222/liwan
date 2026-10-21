<script setup lang="ts">
import type { AssetRecordState } from './useAssetRecord'

// The header actions of an asset's record page: running a draft, or selling or scrapping a running asset.
defineProps<{ record: AssetRecordState }>()
const { t } = useI18n()
</script>

<template>
  <UButton v-if="record.actions?.validate" color="primary" icon="i-lucide-play" :disabled="!record.hydrated || record.busy || record.confirming" :label="t('financeAssets.actions.validate')" data-testid="finance-asset-validate" @click="record.confirming = true" />
  <UButton v-if="record.actions?.dispose" color="neutral" variant="outline" icon="i-lucide-package-x" :disabled="!record.hydrated || record.busy || record.disposing" :label="t('financeAssets.actions.dispose')" data-testid="finance-asset-dispose" @click="record.disposing = true" />
</template>
