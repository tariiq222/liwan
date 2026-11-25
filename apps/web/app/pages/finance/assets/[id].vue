<script setup lang="ts">
import AssetRecordActions from '@/components/finance/assets/AssetRecordActions.vue'
import AssetRecordAside from '@/components/finance/assets/AssetRecordAside.vue'
import AssetRecordBody from '@/components/finance/assets/AssetRecordBody.vue'
import { useAssetRecord } from '@/components/finance/assets/useAssetRecord'

const record = useAssetRecord()
</script>

<template>
  <SharedRecordPage v-bind="record.header" @retry="record.retry">
    <template v-if="record.asset" #actions><AssetRecordActions :record="record" /></template>
    <AssetRecordBody :record="record" />
    <template v-if="record.asset" #aside><AssetRecordAside :record="record" /></template>
  </SharedRecordPage>
</template>
