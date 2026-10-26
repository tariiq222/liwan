<script setup lang="ts">
import EquipmentForm from '@/components/hr/assets/EquipmentForm.vue'
import { owningListBack } from '@/utils/recordListOrigin'
import type { HrEquipment } from '@/composables/useHrAssets'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { can } = useAccess()

const sourcePaths = useRecordListPaths(['/hr/assets'])
const backTo = computed(() => owningListBack(route.query, sourcePaths.value, route.hash))
const canManage = computed(() => can('hr.assets.manage'))
const categories = useHrAssetCategories()

function saved(equipment: HrEquipment) {
  void navigateTo({
    path: `/hr/assets/${equipment.id}`,
    query: { returnTo: router.resolve(backTo.value).fullPath },
  }, { replace: true })
}
</script>

<template>
  <SharedCreatePanel :title="t('hrAssets.new')" :back-to="backTo">
    <SharedForbiddenState v-if="!canManage" />
    <SharedPageState v-else :loading="categories.isLoading.value" :error="categories.error.value" @retry="categories.refetch">
      <EquipmentForm :categories="categories.data.value?.items ?? []" :back-to="backTo" @saved="saved" />
    </SharedPageState>
  </SharedCreatePanel>
</template>
