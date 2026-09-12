<script setup lang="ts">
import { useAdminUserCandidates } from '@/composables/useAdminUsers'

const route = useRoute()
const { t } = useI18n()
const employeeId = computed(() => Number(route.params.employeeId))
// The owning list is fixed by this page's own route, so the return trip is
// literal and carries only the state the list was showing. A referrer's
// returnTo is dropped rather than forwarded: on the list URL it would nest one
// level deeper on every round trip and redirect that page's own controls.
const backTo = computed(() => {
  const { returnTo: _referrer, ...listQuery } = route.query
  return { path: '/hr', query: listQuery }
})
const candidates = useAdminUserCandidates(computed(() => ({ employee_id: employeeId.value, limit: 1 })))
watch(candidates.data, (data) => {
  const employee = data?.items.find((item) => item.id === employeeId.value)
  if (!employee) return
  const target = employee.user_id
    ? `/settings/users/${employee.user_id}`
    : { path: '/settings/users/new', query: { employee_id: String(employee.id) } }
  void navigateTo(target, { replace: true })
}, { immediate: true })
</script>
<template>
  <SharedPageContainer width="form">
    <SharedPageHeader :title="t('hr.employee.access')" :back-to="backTo" />
    <SharedPageState :loading="candidates.isLoading.value" :error="candidates.error.value" :empty="!candidates.data.value?.items.length" @retry="candidates.refetch" />
  </SharedPageContainer>
</template>
