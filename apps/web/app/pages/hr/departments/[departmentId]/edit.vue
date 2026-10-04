<script setup lang="ts">
import { hrDepartmentContext } from '@/utils/hrReturnTo'
import DepartmentForm from '@/components/hr/DepartmentForm.vue'
import { useHrDepartment, useHrDepartments } from '@/composables/useHrDepartments'
import { useHrEmployees } from '@/composables/useHrEmployees'
const route = useRoute(); const { t } = useI18n(); const { can } = useAccess(); const departments = useHrDepartments(); const employees = useHrEmployees({}); const id = computed(() => Number(route.params.departmentId)); const query = useHrDepartment(id); const department = computed(() => query.data.value)
const canManage = computed(() => can('hr.departments.manage'))
const initialDataReady = computed(() => Boolean(query.data.value && departments.data.value && employees.data.value))
const dependencyError = computed(() => query.error.value || departments.error.value || employees.error.value)
function retryDependencies() { void query.refetch(); void departments.refetch(); void employees.refetch() }
const backTo = computed(() => ({ path: `/hr/departments/${id.value}`, query: hrDepartmentContext(route.query), ...(route.hash ? { hash: route.hash } : {}) }))
function saved() { void navigateTo(backTo.value) }
</script>
<template>
  <SharedPageContainer width="form">
    <SharedPageHeader :title="t('hr.depts.edit')" :back-to="backTo" />
    <SharedPageState v-if="!canManage" :empty="true" :empty-text="t('errors.forbidden')" />
    <SharedPageState v-else :loading="query.isLoading.value || departments.isLoading.value || employees.isLoading.value" :error="initialDataReady ? undefined : dependencyError" :empty="!department" @retry="retryDependencies">
      <UCard v-if="department" class="rounded-lg ring ring-default bg-default overflow-hidden" :ui="{ body: 'p-5 sm:p-6' }"><DepartmentForm :department="department" :departments="departments.data.value?.items ?? []" :employees="employees.data.value?.items ?? []" :back-to="backTo" @saved="saved" /></UCard>
    </SharedPageState>
    <SharedPageState v-if="canManage && initialDataReady && dependencyError" :error="dependencyError" @retry="retryDependencies" />
  </SharedPageContainer>
</template>
