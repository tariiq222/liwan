<script setup lang="ts">
import EmployeeGeneralForm from '@/components/hr/EmployeeGeneralForm.vue'
import { useHrDepartments } from '@/composables/useHrDepartments'
import { useHrEmployee, useHrEmployees } from '@/composables/useHrEmployees'
const route = useRoute(); const { t } = useI18n(); const { can } = useAccess(); const hydrated = useHydrated(); const id = computed(() => Number(route.params.employeeId)); const query = useHrEmployee(id)
// The owning list is fixed by this page's own route, so the return trip is
// literal and carries only the state the list was showing. A referrer's
// returnTo is dropped rather than forwarded: on the list URL it would nest one
// level deeper on every round trip and redirect that page's own controls.
const backTo = computed(() => {
  const { returnTo: _referrer, ...listQuery } = route.query
  return { path: '/hr', query: listQuery }
})
const departments = useHrDepartments(); const employees = useHrEmployees({})
const canManage = computed(() => can('hr.employees.manage'))
const initialDataReady = computed(() => Boolean(query.data.value && departments.data.value && employees.data.value))
const dependencyError = computed(() => query.error.value || departments.error.value || employees.error.value)
function retryDependencies() { void query.refetch(); void departments.refetch(); void employees.refetch() }
function saved() { void navigateTo(`/hr/employees/${id.value}`) }
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
      <UCard v-if="query.data.value" class="nasq-ui-record-surface" :ui="{ body: 'p-5 sm:p-6' }">
        <EmployeeGeneralForm :employee="query.data.value" :departments="departments.data.value?.items ?? []" :employees="employees.data.value?.items ?? []" @saved="saved">
          <template #actions>
            <UButton type="button" color="neutral" variant="outline" :disabled="!hydrated" :to="backTo" :label="t('app.cancel')" @click="!hydrated && $event.preventDefault()" />
          </template>
        </EmployeeGeneralForm>
      </UCard>
    </SharedPageState>
    <SharedPageState v-if="canManage && initialDataReady && dependencyError" :error="dependencyError" @retry="retryDependencies" />
  </SharedPageContainer>
</template>
