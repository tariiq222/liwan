<script setup lang="ts">
import DepartmentForm from '@/components/hr/DepartmentForm.vue'
import { useHrDepartment, useHrDepartments } from '@/composables/useHrDepartments'
import { useHrEmployees } from '@/composables/useHrEmployees'
const route = useRoute(); const { t } = useI18n(); const { can } = useAccess(); const departments = useHrDepartments(); const employees = useHrEmployees({}); const id = computed(() => Number(route.params.departmentId)); const query = useHrDepartment(id); const department = computed(() => query.data.value)
const canManage = computed(() => can('hr.departments.manage'))
const initialDataReady = computed(() => Boolean(query.data.value && departments.data.value && employees.data.value))
const dependencyError = computed(() => query.error.value || departments.error.value || employees.error.value)
function retryDependencies() { void query.refetch(); void departments.refetch(); void employees.refetch() }
// The owning list is fixed by this page's own route, so the return trip is
// literal and carries only the state the list was showing. A referrer's
// returnTo is dropped rather than forwarded: on the list URL it would nest one
// level deeper on every round trip and redirect that page's own controls.
const backTo = computed(() => {
  const { returnTo: _referrer, ...listQuery } = route.query
  return { path: '/hr/departments', query: listQuery }
})
function saved() { void navigateTo(`/hr/departments/${id.value}`) }
</script>
<template>
  <SharedPageContainer width="form">
    <SharedPageHeader :title="t('hr.depts.edit')" :back-to="backTo" />
    <SharedPageState v-if="!canManage" :empty="true" :empty-text="t('errors.forbidden')" />
    <SharedPageState v-else :loading="query.isLoading.value || departments.isLoading.value || employees.isLoading.value" :error="initialDataReady ? undefined : dependencyError" :empty="!department" @retry="retryDependencies">
      <UCard v-if="department" class="nasq-ui-record-surface" :ui="{ body: 'p-5 sm:p-6' }"><DepartmentForm :department="department" :departments="departments.data.value?.items ?? []" :employees="employees.data.value?.items ?? []" :back-to="backTo" @saved="saved" /></UCard>
    </SharedPageState>
    <SharedPageState v-if="canManage && initialDataReady && dependencyError" :error="dependencyError" @retry="retryDependencies" />
  </SharedPageContainer>
</template>
