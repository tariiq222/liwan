<script setup lang="ts">
import { safeReturnTo } from '@liwan/ui/app/utils/safeReturnTo'
import AssetProfileEditor from '@/components/finance/records/AssetProfileEditor.vue'
import AssetProfilesSection from '@/components/finance/records/AssetProfilesSection.vue'

const LIST_PATH = '/settings/apps/finance/asset-profiles'
const { t } = useI18n()
const { can } = useAccess()
const route = useRoute()
const router = useRouter()
const canRead = computed(() => can('finance.assets.read'))
const canManage = computed(() => can('finance.assets.manage'))
const backTo = computed(() => safeReturnTo(route.query.returnTo, LIST_PATH, [LIST_PATH]))
</script>

<template>
  <SharedListPage :title="t('financeRecords.assetProfiles.title')" hide-header>
    <AssetProfilesSection v-if="canRead" background />
  </SharedListPage>
  <SharedCreatePanel :title="t('financeRecords.assetProfiles.new')" :back-to="backTo">
    <AssetProfileEditor v-if="canManage" @done="router.replace(backTo)" @cancel="router.push(backTo)" />
    <SharedForbiddenState v-else :description="t('financeRecords.forbidden')" />
  </SharedCreatePanel>
</template>
