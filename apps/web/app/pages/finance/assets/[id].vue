<script setup lang="ts">
import FinanceRecordHero from '@/components/finance/FinanceRecordHero.vue'
import AssetRecordActions from '@/components/finance/assets/AssetRecordActions.vue'
import AssetRecordAside from '@/components/finance/assets/AssetRecordAside.vue'
import AssetRecordBody from '@/components/finance/assets/AssetRecordBody.vue'
import { ASSET_STATE_TONE } from '@/components/finance/assets/assetTones'
import { useAssetRecord } from '@/components/finance/assets/useAssetRecord'

const { t } = useI18n()
const record = useAssetRecord()
</script>

<template>
  <SharedRecordPage v-bind="record.header" @retry="record.retry">
    <template v-if="record.asset" #actions><AssetRecordActions :record="record" /></template>
    <template v-if="record.asset" #summary>
      <FinanceRecordHero
        icon="i-lucide-package"
        :tone="ASSET_STATE_TONE[record.asset.state]"
        :title="record.asset.name"
        :facts="[
          { icon: 'i-lucide-contact', label: t('financeAssets.record.partner'), value: record.asset.partner?.name },
          { icon: 'i-lucide-calendar', label: t('financeAssets.columns.dateStart'), value: record.asset.date_start },
        ]"
        data-testid="finance-asset-hero"
      />
    </template>
    <AssetRecordBody :record="record" />
    <template v-if="record.asset" #aside><AssetRecordAside :record="record" /></template>
  </SharedRecordPage>
</template>
