<script setup lang="ts">
import EnrollmentForm from '@/components/hr/insurance/EnrollmentForm.vue'
import { owningListBack } from '@/utils/recordListOrigin'
import type { HrInsuranceEnrollmentDetail } from '@liwan/contracts'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()

const sourcePaths = useRecordListPaths(['/hr/insurance'])
const backTo = computed(() => owningListBack(route.query, sourcePaths.value, route.hash))
// Only running plans take new enrollments: an expired or archived plan is not offered.
const plans = useHrInsurancePlans({ state: 'active', limit: 100 })

function saved(enrollment: HrInsuranceEnrollmentDetail) {
  void navigateTo({
    path: `/hr/insurance/enrollments/${enrollment.id}`,
    query: { returnTo: router.resolve(backTo.value).fullPath },
  }, { replace: true })
}
</script>

<template>
  <SharedCreatePanel :title="t('hrInsurance.newEnrollment')" :back-to="backTo">
    <SharedPageState :loading="plans.isLoading.value" :error="plans.error.value" @retry="plans.refetch()">
      <EnrollmentForm :plans="plans.data.value?.items ?? []" :back-to="backTo" @saved="saved" />
    </SharedPageState>
  </SharedCreatePanel>
</template>
