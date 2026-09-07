<script setup lang="ts">
import { useAdminUserCandidates } from '@/composables/useAdminUsers'
import { returnToQuery } from '@/utils/safeReturnTo'

const route = useRoute()
const employeeId = computed(() => Number(route.params.employeeId))
const candidates = useAdminUserCandidates(computed(() => ({ employee_id: employeeId.value, limit: 1 })))
watch(candidates.data, (data) => {
  const employee = data?.items.find((item) => item.id === employeeId.value)
  if (!employee) return
  const returnTo = '/settings/users'
  const target = employee.user_id
    ? { path: `/settings/users/${employee.user_id}`, query: returnToQuery(returnTo) }
    : { path: '/settings/users/new', query: { employee_id: String(employee.id), ...returnToQuery(returnTo) } }
  void navigateTo(target, { replace: true })
}, { immediate: true })
</script>
<template><SharedPageState :loading="candidates.isLoading.value" :error="candidates.error.value" :empty="!candidates.data.value?.items.length" @retry="candidates.refetch" /></template>
