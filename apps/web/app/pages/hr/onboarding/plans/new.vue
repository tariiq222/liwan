<script setup lang="ts">
import PlanForm from '@/components/hr/lifecycle/PlanForm.vue'

const NAMESPACE = 'hrOnboarding'
const { t } = useI18n()
const { can } = useAccess()
const backTo = '/hr/onboarding/plans'
function saved() {
  void navigateTo({ path: backTo }, { replace: true })
}
</script>

<template>
  <SharedCreatePanel :title="t(`hrOnboarding.plans.new`)" :back-to="backTo">
    <SharedPageState v-if="!can('hr.onboarding.manage')" :empty="true" :empty-text="t(`hrOnboarding.errors.forbidden`)" />
    <PlanForm v-else area="onboarding" :namespace="NAMESPACE" :back-to="backTo" @saved="saved" />
  </SharedCreatePanel>
</template>
