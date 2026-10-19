<script setup lang="ts">
import { owningListBack } from '@/utils/recordListOrigin'
import LeaveRequestForm from '@/components/hr/LeaveRequestForm.vue'

const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
const sourcePaths = useRecordListPaths(['/hr/leave'])
const backTo = computed(() => owningListBack(route.query, sourcePaths.value, route.hash))
// A request has no record page: the list shows it, so saving returns there.
function saved() { void navigateTo(backTo.value, { replace: true }) }
</script>

<template>
  <SharedCreatePanel :title="t('hr.leave.new')" :back-to="backTo">
    <SharedPageState v-if="!can('hr.leave.request')" :empty="true" :empty-text="t('errors.forbidden')" />
    <LeaveRequestForm v-else :back-to="backTo" @saved="saved" />
  </SharedCreatePanel>
</template>
