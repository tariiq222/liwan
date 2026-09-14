<script setup lang="ts">
import EmployeeGeneralForm from '@/components/hr/EmployeeGeneralForm.vue'
import { useHrDepartments } from '@/composables/useHrDepartments'
import { useHrEmployee, useHrEmployees } from '@/composables/useHrEmployees'
const route = useRoute(); const { t } = useI18n(); const { can } = useAccess(); const hydrated = useHydrated(); const id = computed(() => Number(route.params.employeeId)); const query = useHrEmployee(id)
// An edit form returns to the record it edits, not past it to the list: being
// thrown back to the list is exactly what the reader did not ask for. The
// target is fixed by this page's own route and carries the list state through,
// so the record's own back control still lands on a filtered list. A referrer's
// returnTo is dropped rather than forwarded: on the destination URL it would
// nest one level deeper on every round trip and redirect that page's controls.
const backTo = computed(() => {
  const { returnTo: _referrer, ...listQuery } = route.query
  return { path: `/hr/employees/${id.value}`, query: listQuery }
})
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
      <UCard v-if="query.data.value" class="rounded-lg ring ring-default bg-default overflow-hidden" :ui="{ body: 'p-5 sm:p-6' }">
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
