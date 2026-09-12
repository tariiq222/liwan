<script setup lang="ts">
import EmployeeGeneralForm from '@/components/hr/EmployeeGeneralForm.vue'
import { useHrDepartments } from '@/composables/useHrDepartments'
import { useHrEmployees } from '@/composables/useHrEmployees'
const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
// The owning list is fixed by this page's own route, so the return trip is
// literal and carries only the state the list was showing. A referrer's
// returnTo is dropped rather than forwarded: on the list URL it would nest one
// level deeper on every round trip and redirect that page's own controls.
const backTo = computed(() => {
  const { returnTo: _referrer, ...listQuery } = route.query
  return { path: '/hr', query: listQuery }
})
const departments = useHrDepartments()
const employees = useHrEmployees({})
const canManage = computed(() => can('hr.employees.manage'))
const initialDataReady = computed(() => Boolean(departments.data.value && employees.data.value))
const dependencyError = computed(() => departments.error.value || employees.error.value)
function retryDependencies() { void departments.refetch(); void employees.refetch() }
function created(employee: { id: number }) { void navigateTo(`/hr/employees/${employee.id}`) }
</script>
<template>
  <SharedPageContainer width="form">
    <SharedPageHeader :title="t('hr.employee.createTitle')" :back-to="backTo" />
    <SharedPageState v-if="!canManage" :empty="true" :empty-text="t('errors.forbidden')" />
    <SharedPageState
      v-else
      :loading="departments.isLoading.value || employees.isLoading.value"
      :error="initialDataReady ? undefined : dependencyError"
      @retry="retryDependencies"
    >
      <UCard class="nasq-ui-record-surface" :ui="{ body: 'p-5 sm:p-6' }">
        <EmployeeGeneralForm :departments="departments.data.value?.items ?? []" :employees="employees.data.value?.items ?? []" @saved="created">
          <template #actions>
            <UButton type="button" color="neutral" variant="outline" :disabled="!hydrated" :to="backTo" :label="t('app.cancel')" @click="!hydrated && $event.preventDefault()" />
          </template>
        </EmployeeGeneralForm>
      </UCard>
    </SharedPageState>
    <SharedPageState v-if="canManage && initialDataReady && dependencyError" :error="dependencyError" @retry="retryDependencies" />
  </SharedPageContainer>
</template>
