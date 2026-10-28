<script setup lang="ts">
import type { AssetRecordState } from './useAssetRecord'

// The header actions of an asset's record page: running or editing a draft, or selling or scrapping a running asset, and
// a menu for deleting a draft.
defineProps<{ record: AssetRecordState }>()
const { t } = useI18n()
</script>

<template>
  <template v-if="record.actions && !record.editing">
    <UButton v-if="record.actions.offers('validate')" color="primary" icon="i-lucide-play" :disabled="!record.hydrated || record.busy || !!record.confirming || !record.actions.can('validate')" :label="t('financeAssets.actions.validate')" data-testid="finance-asset-validate" @click="record.confirming = 'validate'" />
    <UButton v-if="record.actions.offers('edit')" color="neutral" variant="outline" icon="i-lucide-pencil" :disabled="!record.hydrated || record.busy || !record.actions.can('edit')" :label="t('app.edit')" data-testid="finance-asset-edit" @click="record.edit()" />
    <UButton v-if="record.actions.offers('dispose')" color="neutral" variant="outline" icon="i-lucide-package-x" :disabled="!record.hydrated || record.busy || record.disposing || !record.actions.can('dispose')" :label="t('financeAssets.actions.dispose')" data-testid="finance-asset-dispose" @click="record.disposing = true" />
    <SharedRowActions v-if="record.menu.length" :actions="record.menu" :label="t('financeAssets.actions.menuFor', { name: record.asset?.name ?? '' })" :disabled="record.busy" />
  </template>
</template>
