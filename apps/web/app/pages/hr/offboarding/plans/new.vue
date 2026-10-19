<script setup lang="ts">
import PlanForm from '@/components/hr/lifecycle/PlanForm.vue'

const NAMESPACE = 'hrOffboarding'
const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
const backTo = '/hr/offboarding/plans'
function saved() {
  void navigateTo({ path: backTo }, { replace: true })
}
</script>

<template>
  <SharedCreatePanel :title="t(`hrOffboarding.plans.new`)" :back-to="backTo">
    <SharedPageState v-if="!can('hr.offboarding.manage')" :empty="true" :empty-text="t(`hrOffboarding.errors.forbidden`)" />
    <PlanForm v-else area="offboarding" :namespace="NAMESPACE" :back-to="backTo" @saved="saved" />
  </SharedCreatePanel>
</template>
