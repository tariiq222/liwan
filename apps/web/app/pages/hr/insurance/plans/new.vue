<script setup lang="ts">
import PlanForm from '@/components/hr/insurance/PlanForm.vue'
import { owningListBack } from '@/utils/recordListOrigin'
import type { HrInsurancePlan } from '@liwan/contracts'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()

const sourcePaths = useRecordListPaths(['/hr/insurance'])
const backTo = computed(() => owningListBack(route.query, sourcePaths.value, route.hash))
const providers = useHrInsuranceProviders('true')

function saved(plan: HrInsurancePlan) {
  void navigateTo({
    path: `/hr/insurance/plans/${plan.id}`,
    query: { returnTo: router.resolve(backTo.value).fullPath },
  }, { replace: true })
}
</script>

<template>
  <SharedCreatePanel :title="t('hrInsurance.newPlan')" :back-to="backTo">
    <SharedPageState :loading="providers.isLoading.value" :error="providers.error.value" @retry="providers.refetch">
      <PlanForm :providers="providers.data.value?.items ?? []" :back-to="backTo" @saved="saved" />
    </SharedPageState>
  </SharedCreatePanel>
</template>
