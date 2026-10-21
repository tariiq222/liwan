<script setup lang="ts">
import AssetProfilesSection from '@/components/finance/records/AssetProfilesSection.vue'

const { t } = useI18n()
const { can } = useAccess()
const allowed = computed(() => can('finance.assets.read'))
</script>

<template>
  <SharedSettingsPage width="detail">
    <SharedPageHeader :title="t('financeRecords.assetProfiles.title')" />
    <SharedForbiddenState v-if="!allowed" :description="t('financeRecords.forbidden')" />
    <AssetProfilesSection v-else />
  </SharedSettingsPage>
</template>
