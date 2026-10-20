<script setup lang="ts">
import DepartureForm from '@/components/hr/lifecycle/DepartureForm.vue'

const NAMESPACE = 'hrOffboarding'
const { t } = useI18n()
const { can } = useAccess()
const backTo = '/hr/offboarding'
function saved() {
  void navigateTo({ path: '/hr/offboarding', query: {} }, { replace: true })
}
</script>

<template>
  <SharedCreatePanel :title="t(`${NAMESPACE}.departures.new`)" :back-to="backTo">
    <SharedPageState v-if="!can('hr.offboarding.manage')" :empty="true" :empty-text="t(`${NAMESPACE}.errors.forbidden`)" />
    <DepartureForm v-else :namespace="NAMESPACE" :back-to="backTo" @saved="saved" />
  </SharedCreatePanel>
</template>
