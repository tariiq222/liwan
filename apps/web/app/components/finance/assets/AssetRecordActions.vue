<script setup lang="ts">
import type { AssetRecordState } from './useAssetRecord'

// The header action of an asset's record page: running a draft.
defineProps<{ record: AssetRecordState }>()
const { t } = useI18n()
</script>

<template>
  <UButton v-if="record.actions?.validate" color="primary" icon="i-lucide-play" :disabled="!record.hydrated || record.busy || record.confirming" :label="t('financeAssets.actions.validate')" data-testid="finance-asset-validate" @click="record.confirming = true" />
</template>
