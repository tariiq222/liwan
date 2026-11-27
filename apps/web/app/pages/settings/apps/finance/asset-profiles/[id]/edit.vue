<script setup lang="ts">
import { safeReturnTo } from '@liwan/ui/app/utils/safeReturnTo'
import AssetProfileEditor from '@/components/finance/records/AssetProfileEditor.vue'
import { useSetupAssetProfile } from '@/composables/finance/useFinanceRecords'
import { queryPositiveInt } from '@/utils/routeQuery'

const LIST_PATH = '/settings/apps/finance/asset-profiles'
const { t } = useI18n()
const { can } = useAccess()
const route = useRoute()
const router = useRouter()
const canManage = computed(() => can('finance.assets.manage'))
const id = computed(() => queryPositiveInt(route.params.id))
const query = useSetupAssetProfile(id, canManage)
const backTo = computed(() => safeReturnTo(route.query.returnTo, LIST_PATH, [LIST_PATH]))
</script>

<template>
  <SharedPageContainer>
    <SharedPageHeader
      :title="t('financeRecords.assetProfiles.editTitle')"
      :back-to="backTo"
      :back-label="t('financeRecords.assetProfiles.title')"
    />
    <SharedForbiddenState v-if="!canManage" :description="t('financeRecords.forbidden')" />
    <SharedPageState
      v-else
      :loading="id !== null && query.isPending.value"
      :error="id === null ? { status: 404 } : query.error.value"
      @retry="query.refetch()"
    >
      <SharedFormSection v-if="query.data.value" panel>
        <AssetProfileEditor
          :key="query.data.value.id"
          :profile="query.data.value"
          @done="router.replace(backTo)"
          @cancel="router.push(backTo)"
        />
      </SharedFormSection>
    </SharedPageState>
  </SharedPageContainer>
</template>
