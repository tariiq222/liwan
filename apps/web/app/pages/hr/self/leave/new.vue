<script setup lang="ts">
definePageMeta({ path: '/account/leave/new' })
import { owningListBack } from '@/utils/recordListOrigin'
import LeaveRequestForm from '@/components/hr/LeaveRequestForm.vue'

const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
const profile = useMyHrProfile()
const sourcePaths = computed(() => ['/account/leave', '/account'])
const backTo = computed(() => owningListBack(route.query, sourcePaths.value, route.hash))
// Return to the overview or personal leave list that opened this form.
function saved() { void navigateTo(backTo.value, { replace: true }) }
</script>

<template>
  <SharedCreatePanel :title="t('hr.leave.new')" :back-to="backTo">
    <SharedPageState v-if="!can('hr.leave.request')" :empty="true" :empty-text="t('errors.forbidden')" />
    <SharedPageState v-else :loading="profile.isLoading.value" :error="profile.error.value" @retry="profile.refetch">
      <SharedEmptyState v-if="profile.data.value === null" bordered :title="t('hr.self.noEmployee')" :description="t('hr.self.noEmployeeHint')" />
      <LeaveRequestForm v-else-if="profile.data.value" :back-to="backTo" @saved="saved" />
    </SharedPageState>
  </SharedCreatePanel>
</template>
