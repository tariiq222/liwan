<script setup lang="ts">
import { useAdminUserCandidates } from '@/composables/useAdminUsers'
import { returnToQuery, safeReturnTo } from '@/utils/safeReturnTo'

const route = useRoute()
const { t } = useI18n()
const employeeId = computed(() => Number(route.params.employeeId))
const returnTo = computed(() => safeReturnTo(route.query.returnTo, `/hr/employees/${employeeId.value}`, ['/hr']))
const candidates = useAdminUserCandidates(computed(() => ({ employee_id: employeeId.value, limit: 1 })))
watch(candidates.data, (data) => {
  const employee = data?.items.find((item) => item.id === employeeId.value)
  if (!employee) return
  const settingsReturn = '/settings/users'
  const target = employee.user_id
    ? { path: `/settings/users/${employee.user_id}`, query: returnToQuery(settingsReturn) }
    : { path: '/settings/users/new', query: { employee_id: String(employee.id), ...returnToQuery(settingsReturn) } }
  void navigateTo(target, { replace: true })
}, { immediate: true })
</script>
<template>
  <SharedPageContainer width="form">
    <SharedPageHeader :title="t('hr.employee.access')" :back-to="returnTo" />
    <SharedPageState :loading="candidates.isLoading.value" :error="candidates.error.value" :empty="!candidates.data.value?.items.length" @retry="candidates.refetch" />
  </SharedPageContainer>
</template>
