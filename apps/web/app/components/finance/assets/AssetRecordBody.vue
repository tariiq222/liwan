<script setup lang="ts">
import AssetBoardPanel from './AssetBoardPanel.vue'
import type { AssetRecordState } from './useAssetRecord'

// The main column of an asset's record page: the inline message and confirmation of running it, the note, then the board.
defineProps<{ record: AssetRecordState }>()
const { t } = useI18n()
</script>

<template>
  <UAlert v-if="record.actionError" role="alert" color="error" variant="subtle" :title="record.actionError" data-testid="finance-asset-action-error" />
  <template v-if="record.asset">
    <SharedInlineConfirm
      v-if="record.confirming"
      color="primary"
      :title="t('financeAssets.confirm.validate', { name: record.asset.name })"
      :description="t('financeAssets.confirm.validateHint')"
      :confirm-label="t('financeAssets.actions.validate')"
      :pending="record.busy"
      :disabled="!record.hydrated"
      @confirm="record.applyValidation()"
      @cancel="record.confirming = false"
    />
    <SharedRecordSection v-if="record.asset.note" variant="tinted" :title="t('financeAssets.record.note')" data-testid="finance-asset-note">
      <p class="whitespace-pre-line text-sm">{{ record.asset.note }}</p>
    </SharedRecordSection>
    <AssetBoardPanel :asset="record.asset" />
  </template>
</template>
