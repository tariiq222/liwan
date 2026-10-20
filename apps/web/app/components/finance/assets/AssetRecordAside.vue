<script setup lang="ts">
import Money from '../invoices/Money.vue'
import { assetDuration } from './assetMethod'
import type { AssetRecordState } from './useAssetRecord'

// The aside of an asset's record page: its properties and the depreciation method it follows.
defineProps<{ record: AssetRecordState }>()
const { t } = useI18n()
</script>

<template>
  <SharedPropertiesPanel v-if="record.asset">
    <SharedPropertyRow :label="t('financeAssets.columns.code')"><bdi class="tabular-nums">{{ record.asset.code || t('app.notAvailable') }}</bdi></SharedPropertyRow>
    <SharedPropertyRow :label="t('financeAssets.columns.profile')" :value="record.asset.profile.name" />
    <SharedPropertyRow :label="t('financeAssets.record.partner')" :value="record.asset.partner?.name ?? null" />
    <SharedPropertyRow :label="t('financeAssets.columns.dateStart')"><bdi class="tabular-nums">{{ record.asset.date_start }}</bdi></SharedPropertyRow>
    <SharedPropertyRow :label="t('financeAssets.record.method')" :value="t(`financeAssets.methods.${record.asset.method}`)" />
    <SharedPropertyRow :label="t('financeAssets.record.duration')" :value="assetDuration(record.asset, t)" />
    <SharedPropertyRow :label="t('financeAssets.record.period')" :value="t(`financeAssets.periods.${record.asset.method_period}`)" />
    <SharedPropertyRow :label="t('financeAssets.record.prorata')" :value="t(record.asset.prorata ? 'financeAssets.record.prorataYes' : 'financeAssets.record.prorataNo')" />
    <SharedPropertyRow :label="t('financeAssets.record.currency')" :value="record.asset.currency" />
    <SharedPropertyRow :label="t('financeAssets.columns.purchaseValue')"><Money :amount="record.asset.purchase_value" :currency="record.asset.currency" /></SharedPropertyRow>
    <SharedPropertyRow :label="t('financeAssets.record.salvageValue')"><Money :amount="record.asset.salvage_value" :currency="record.asset.currency" /></SharedPropertyRow>
    <SharedPropertyRow :label="t('financeAssets.record.depreciationBase')"><Money :amount="record.asset.depreciation_base" :currency="record.asset.currency" /></SharedPropertyRow>
    <SharedPropertyRow :label="t('financeAssets.record.valueDepreciated')"><Money :amount="record.asset.value_depreciated" :currency="record.asset.currency" /></SharedPropertyRow>
    <SharedPropertyRow :label="t('financeAssets.columns.valueResidual')"><Money :amount="record.asset.value_residual" :currency="record.asset.currency" /></SharedPropertyRow>
  </SharedPropertiesPanel>
</template>
