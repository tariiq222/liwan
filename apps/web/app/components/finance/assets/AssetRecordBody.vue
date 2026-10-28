<script setup lang="ts">
import AssetDisposePanel from './AssetDisposePanel.vue'
import AssetBoardPanel from './AssetBoardPanel.vue'
import AssetForm from './AssetForm.vue'
import { assetDraftFromRecord } from './assetDraft'
import FinanceBlockedNotice from '../FinanceBlockedNotice.vue'
import type { AssetRecordState } from './useAssetRecord'

// The main column of an asset's record page: the inline message and confirmation of its actions, the disposal form, the note, then the board, or the draft's editor while it is being edited.
defineProps<{ record: AssetRecordState }>()
const { t } = useI18n()
</script>

<template>
  <UAlert v-if="record.actionError" role="alert" color="error" variant="subtle" :title="record.actionError" data-testid="finance-asset-action-error" />
  <template v-if="record.asset">
    <FinanceBlockedNotice v-if="record.actions" :reasons="record.actions.reasons" />
    <SharedInlineConfirm
      v-if="record.confirming === 'validate'"
      color="primary"
      :title="t('financeAssets.confirm.validate', { name: record.asset.name })"
      :description="t('financeAssets.confirm.validateHint')"
      :confirm-label="t('financeAssets.actions.validate')"
      :pending="record.busy"
      :disabled="!record.hydrated"
      @confirm="record.applyValidation()"
      @cancel="record.confirming = null"
    />
    <SharedInlineConfirm
      v-if="record.confirming === 'delete'"
      color="error"
      :title="t('financeAssets.confirm.delete', { name: record.asset.name })"
      :description="t('financeAssets.confirm.deleteHint')"
      :confirm-label="t('financeAssets.actions.delete')"
      :pending="record.busy"
      :disabled="!record.hydrated"
      @confirm="record.applyDelete()"
      @cancel="record.confirming = null"
    />
    <AssetDisposePanel v-if="record.disposing && record.actions?.can('dispose')" :asset="record.asset" @done="record.disposing = false" @cancel="record.disposing = false" />
    <AssetForm
      v-if="record.editing && record.actions?.can('edit')"
      :record-id="record.asset.id"
      :initial="assetDraftFromRecord(record.asset)"
      :back-to="record.backTo"
      @saved="record.editing = false"
      @cancel="record.editing = false"
    />
    <template v-else>
      <SharedRecordSection v-if="record.asset.note" variant="tinted" :title="t('financeAssets.record.note')" data-testid="finance-asset-note">
        <p class="whitespace-pre-line text-sm">{{ record.asset.note }}</p>
      </SharedRecordSection>
      <AssetBoardPanel :asset="record.asset" />
    </template>
  </template>
</template>
