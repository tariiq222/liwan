<script setup lang="ts">
import { owningListBack } from '@/utils/recordListOrigin'
import LeaveAllocationForm from '@/components/hr/LeaveAllocationForm.vue'

const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
const sourcePaths = useRecordListPaths(['/hr/leave'])
const backTo = computed(() => owningListBack(route.query, sourcePaths.value, route.hash))
function saved() { void navigateTo(backTo.value, { replace: true }) }
</script>

<template>
  <SharedCreatePanel :title="t('hr.leave.allocate')" :back-to="backTo">
    <SharedPageState v-if="!can('hr.leave.manage')" :empty="true" :empty-text="t('errors.forbidden')" />
    <LeaveAllocationForm v-else :back-to="backTo" @saved="saved" />
  </SharedCreatePanel>
</template>
