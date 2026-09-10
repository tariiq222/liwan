<script setup lang="ts">
import DepartmentForm from '@/components/hr/DepartmentForm.vue'
import { useHrDepartment, useHrDepartments } from '@/composables/useHrDepartments'
import { useHrEmployees } from '@/composables/useHrEmployees'
import { safeReturnTo, returnToQuery } from '@/utils/safeReturnTo'
const route = useRoute(); const { t } = useI18n(); const { can } = useAccess(); const departments = useHrDepartments(); const employees = useHrEmployees({}); const id = computed(() => Number(route.params.departmentId)); const query = useHrDepartment(id); const department = computed(() => query.data.value)
const canManage = computed(() => can('hr.departments.manage'))
const initialDataReady = computed(() => Boolean(query.data.value && departments.data.value && employees.data.value))
const dependencyError = computed(() => query.error.value || departments.error.value || employees.error.value)
function retryDependencies() { void query.refetch(); void departments.refetch(); void employees.refetch() }
const fallback = computed(() => `/hr/departments/${id.value}`)
const returnTo = computed(() => safeReturnTo(route.query.returnTo, fallback.value, ['/hr']))
function saved() { void navigateTo({ path: fallback.value, query: returnToQuery(returnTo.value) }) }
</script>
<template>
  <SharedPageContainer width="form">
    <SharedPageHeader :title="t('hr.depts.edit')" :back-to="returnTo" />
    <SharedPageState v-if="!canManage" :empty="true" :empty-text="t('errors.forbidden')" />
    <SharedPageState v-else :loading="query.isLoading.value || departments.isLoading.value || employees.isLoading.value" :error="initialDataReady ? undefined : dependencyError" :empty="!department" @retry="retryDependencies">
      <section v-if="department" class="nasq-panel nasq-panel-body"><DepartmentForm :department="department" :departments="departments.data.value?.items ?? []" :employees="employees.data.value?.items ?? []" :back-to="returnTo" @saved="saved" /></section>
    </SharedPageState>
    <SharedPageState v-if="canManage && initialDataReady && dependencyError" :error="dependencyError" @retry="retryDependencies" />
  </SharedPageContainer>
</template>
