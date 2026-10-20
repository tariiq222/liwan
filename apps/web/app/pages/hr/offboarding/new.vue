<script setup lang="ts">
import DepartureForm from '@/components/hr/lifecycle/DepartureForm.vue'
import { owningListBack } from '@/utils/recordListOrigin'

const NAMESPACE = 'hrOffboarding'
const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
const sourcePaths = useRecordListPaths(['/hr/offboarding'])
const backTo = computed(() => owningListBack(route.query, sourcePaths.value, route.hash))
function saved() {
  void navigateTo(backTo.value, { replace: true })
}
</script>

<template>
  <SharedCreatePanel :title="t(`${NAMESPACE}.departures.new`)" :back-to="backTo">
    <SharedPageState v-if="!can('hr.offboarding.manage')" :empty="true" :empty-text="t(`${NAMESPACE}.errors.forbidden`)" />
    <DepartureForm v-else :namespace="NAMESPACE" :back-to="backTo" @saved="saved" />
  </SharedCreatePanel>
</template>
