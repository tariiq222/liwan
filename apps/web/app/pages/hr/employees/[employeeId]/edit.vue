<script setup lang="ts">
import { recordParentTo, EMPLOYEE_LIST_PATHS } from '@/utils/recordListOrigin'
import EmployeeGeneralForm from '@/components/hr/EmployeeGeneralForm.vue'
import { useHrDepartments } from '@/composables/useHrDepartments'
import { useHrEmployee, useHrEmployees } from '@/composables/useHrEmployees'
const route = useRoute(); const { t } = useI18n(); const { can } = useAccess(); const hydrated = useHydrated(); const id = computed(() => Number(route.params.employeeId)); const query = useHrEmployee(id)
// Child pages always return to their current record; only normalized list context follows.
// Directory Manage opens this editor directly with returnTo; it is accepted
// only as exact directory context, never as this editor's destination.
const backTo = computed(() => recordParentTo(`/hr/employees/${id.value}`, {
  ...route.query, listOrigin: route.query.listOrigin ?? route.query.returnTo ?? null,
}, EMPLOYEE_LIST_PATHS, route.hash))
const departments = useHrDepartments(); const employees = useHrEmployees({})
const canManage = computed(() => can('hr.employees.manage'))
const initialDataReady = computed(() => Boolean(query.data.value && departments.data.value && employees.data.value))
const dependencyError = computed(() => query.error.value || departments.error.value || employees.error.value)
function retryDependencies() { void query.refetch(); void departments.refetch(); void employees.refetch() }
function saved() { void navigateTo(backTo.value) }
</script>
<template>
  <SharedPageContainer width="form">
    <SharedPageHeader :title="t('hr.employee.editTitle')" :back-to="backTo" />
    <SharedPageState v-if="!canManage" :empty="true" :empty-text="t('errors.forbidden')" />
    <SharedPageState
      v-else
      :loading="query.isLoading.value || departments.isLoading.value || employees.isLoading.value"
      :error="initialDataReady ? undefined : dependencyError"
      :empty="!query.data.value"
      @retry="retryDependencies"
    >
      <EmployeeGeneralForm v-if="query.data.value" panel :employee="query.data.value" :departments="departments.data.value?.items ?? []" :employees="employees.data.value?.items ?? []" @saved="saved">
        <template #actions>
          <UButton type="button" color="neutral" variant="outline" :disabled="!hydrated" :to="backTo" :label="t('app.cancel')" @click="!hydrated && $event.preventDefault()" />
        </template>
      </EmployeeGeneralForm>
    </SharedPageState>
    <SharedPageState v-if="canManage && initialDataReady && dependencyError" :error="dependencyError" @retry="retryDependencies" />
  </SharedPageContainer>
</template>
