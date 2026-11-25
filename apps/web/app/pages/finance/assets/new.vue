<script setup lang="ts">
import AssetForm from '@/components/finance/assets/AssetForm.vue'
import AssetList from '@/components/finance/assets/AssetList.vue'
import { useAssetCreatePage } from '@/components/finance/assets/useAssetCreatePage'

const { t } = useI18n()
const page = useAssetCreatePage()
</script>

<template>
  <SharedListPage v-bind="page.list.header">
    <template v-if="page.list.allowed" #kpis>
      <SharedKpiStrip v-if="page.list.kpis.shown && !page.list.kpis.error" :tiles="page.list.kpis.tiles" :loading="page.list.kpis.loading" :label="page.list.kpis.label" data-testid="finance-asset-kpis" />
    </template>
    <AssetList background />
  </SharedListPage>
  <SharedCreatePanel :title="page.title" :back-to="page.backTo">
    <AssetForm v-if="page.allowed" :back-to="page.backTo" @saved="page.saved" />
    <SharedForbiddenState v-else :description="t('financeAssets.forbidden')" />
  </SharedCreatePanel>
</template>
