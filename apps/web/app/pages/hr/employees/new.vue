<script setup lang="ts">
import EmployeeGeneralForm from '@/components/hr/EmployeeGeneralForm.vue'
import { useHrDepartments } from '@/composables/useHrDepartments'
import { useHrEmployees } from '@/composables/useHrEmployees'
import { returnToQuery, safeReturnTo } from '@/utils/safeReturnTo'
const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const returnTo = computed(() => safeReturnTo(route.query.returnTo, '/hr', ['/hr']))
const departments = useHrDepartments()
const employees = useHrEmployees({})
const canManage = computed(() => can('hr.employees.manage'))
const initialDataReady = computed(() => Boolean(departments.data.value && employees.data.value))
const dependencyError = computed(() => departments.error.value || employees.error.value)
function retryDependencies() { void departments.refetch(); void employees.refetch() }
function created(employee: { id: number }) { void navigateTo({ path: `/hr/employees/${employee.id}`, query: returnToQuery(returnTo.value) }) }
</script>
<template>
  <SharedPageContainer width="form">
    <SharedPageHeader :title="t('hr.employee.createTitle')" :back-to="returnTo" />
    <SharedPageState v-if="!canManage" :empty="true" :empty-text="t('errors.forbidden')" />
    <SharedPageState
      v-else
      :loading="departments.isLoading.value || employees.isLoading.value"
      :error="initialDataReady ? undefined : dependencyError"
      @retry="retryDependencies"
    >
      <section class="nasq-panel nasq-panel-body">
        <EmployeeGeneralForm :departments="departments.data.value?.items ?? []" :employees="employees.data.value?.items ?? []" @saved="created">
          <template #actions>
            <Button as-child type="button" variant="outline" :disabled="!hydrated"><NuxtLink :to="returnTo" @click="!hydrated && $event.preventDefault()">{{ t('app.cancel') }}</NuxtLink></Button>
          </template>
        </EmployeeGeneralForm>
      </section>
    </SharedPageState>
    <SharedPageState v-if="canManage && initialDataReady && dependencyError" :error="dependencyError" @retry="retryDependencies" />
  </SharedPageContainer>
</template>
