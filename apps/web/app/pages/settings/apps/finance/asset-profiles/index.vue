<script setup lang="ts">
import { returnToQuery } from '@liwan/ui/app/utils/safeReturnTo'
import AssetProfilesSection from '@/components/finance/records/AssetProfilesSection.vue'

const { t } = useI18n()
const { can } = useAccess()
const route = useRoute()
const allowed = computed(() => can('finance.assets.read'))
const canManage = computed(() => can('finance.assets.manage'))
</script>

<template>
  <SharedListPage
    :title="t('financeRecords.assetProfiles.title')"
    :description="t('financeRecords.assetProfiles.description')"
    :create-to="canManage ? { path: '/settings/apps/finance/asset-profiles/new', query: returnToQuery(route.fullPath) } : undefined"
    :create-label="t('financeRecords.assetProfiles.new')"
    create-test-id="finance-record-asset-profile-new"
  >
    <SharedForbiddenState v-if="!allowed" :description="t('financeRecords.forbidden')" />
    <AssetProfilesSection v-else />
  </SharedListPage>
</template>
