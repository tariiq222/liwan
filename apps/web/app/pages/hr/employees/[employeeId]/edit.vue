<script setup lang="ts">
import EmployeeGeneralForm from '@/components/hr/EmployeeGeneralForm.vue'
import { useHrDepartments } from '@/composables/useHrDepartments'
import { useHrEmployee, useHrEmployees } from '@/composables/useHrEmployees'
import { returnToQuery, safeReturnTo } from '@/utils/safeReturnTo'
const route = useRoute(); const { t } = useI18n(); const { can } = useAccess(); const hydrated = useHydrated(); const id = computed(() => Number(route.params.employeeId)); const query = useHrEmployee(id)
const returnTo = computed(() => safeReturnTo(route.query.returnTo, `/hr/employees/${id.value}`, ['/hr']))
const departments = useHrDepartments(); const employees = useHrEmployees({})
const canManage = computed(() => can('hr.employees.manage'))
const initialDataReady = computed(() => Boolean(query.data.value && departments.data.value && employees.data.value))
const dependencyError = computed(() => query.error.value || departments.error.value || employees.error.value)
function retryDependencies() { void query.refetch(); void departments.refetch(); void employees.refetch() }
function saved() { void navigateTo({ path: `/hr/employees/${id.value}`, query: returnToQuery(returnTo.value) }) }
</script>
<template>
  <SharedPageContainer width="form">
    <SharedPageHeader :title="t('hr.employee.editTitle')" :back-to="returnTo" />
    <SharedPageState v-if="!canManage" :empty="true" :empty-text="t('errors.forbidden')" />
    <SharedPageState
      v-else
      :loading="query.isLoading.value || departments.isLoading.value || employees.isLoading.value"
      :error="initialDataReady ? undefined : dependencyError"
      :empty="!query.data.value"
      @retry="retryDependencies"
    >
      <UCard v-if="query.data.value">
        <EmployeeGeneralForm :employee="query.data.value" :departments="departments.data.value?.items ?? []" :employees="employees.data.value?.items ?? []" @saved="saved">
          <template #actions>
            <UButton type="button" color="neutral" variant="outline" :disabled="!hydrated" :to="returnTo" :label="t('app.cancel')" @click="!hydrated && $event.preventDefault()" />
          </template>
        </EmployeeGeneralForm>
      </UCard>
    </SharedPageState>
    <SharedPageState v-if="canManage && initialDataReady && dependencyError" :error="dependencyError" @retry="retryDependencies" />
  </SharedPageContainer>
</template>
