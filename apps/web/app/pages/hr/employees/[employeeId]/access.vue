<script setup lang="ts">
import { useAdminUserCandidates } from '@/composables/useAdminUsers'

const route = useRoute()
const { t } = useI18n()
const employeeId = computed(() => Number(route.params.employeeId))
// An edit form returns to the record it edits, not past it to the list: being
// thrown back to the list is exactly what the reader did not ask for. The
// target is fixed by this page's own route and carries the list state through,
// so the record's own back control still lands on a filtered list. A referrer's
// returnTo is dropped rather than forwarded: on the destination URL it would
// nest one level deeper on every round trip and redirect that page's controls.
const backTo = computed(() => {
  const { returnTo: _referrer, ...listQuery } = route.query
  return { path: `/hr/employees/${employeeId.value}`, query: listQuery }
})
const candidates = useAdminUserCandidates(computed(() => ({ employee_id: employeeId.value, limit: 1 })))
watch(candidates.data, (data) => {
  const employee = data?.items.find((item) => item.id === employeeId.value)
  if (!employee) return
  const target = employee.user_id
    ? `/settings/team/users/${employee.user_id}`
    : { path: '/settings/team/users/new', query: { employee_id: String(employee.id) } }
  void navigateTo(target, { replace: true })
}, { immediate: true })
</script>
<template>
  <SharedPageContainer width="form">
    <SharedPageHeader :title="t('hr.employee.access')" :back-to="backTo" />
    <SharedPageState :loading="candidates.isLoading.value" :error="candidates.error.value" :empty="!candidates.data.value?.items.length" @retry="candidates.refetch" />
  </SharedPageContainer>
</template>
