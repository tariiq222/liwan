<script setup lang="ts">
import { owningListBack } from '@/utils/recordListOrigin'
import { EMPLOYEE_LIST_PATHS } from '@/modules/hr/navigation'
import EmployeeGeneralForm from '@/components/hr/EmployeeGeneralForm.vue'
import { useHrDepartments } from '@/composables/useHrDepartments'
import { useHrEmployees } from '@/composables/useHrEmployees'
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { can } = useAccess()
const sourcePaths = useRecordListPaths(EMPLOYEE_LIST_PATHS)
const backTo = computed(() => owningListBack(route.query, sourcePaths.value, route.hash))
const departments = useHrDepartments()
const employees = useHrEmployees({})
const canManage = computed(() => can('hr.employees.manage'))
const initialDataReady = computed(() => Boolean(departments.data.value && employees.data.value))
const dependencyError = computed(() => departments.error.value || employees.error.value)
function retryDependencies() { void departments.refetch(); void employees.refetch() }
function created(employee: { id: number }) { void navigateTo({ path: `/hr/employees/${employee.id}`, query: { returnTo: router.resolve(backTo.value).fullPath } }, { replace: true }) }
</script>
<template>
  <SharedCreatePanel :title="t('hr.employee.createTitle')" :back-to="backTo">
    <SharedForbiddenState v-if="!canManage" />
    <SharedPageState
      v-else
      :loading="departments.isLoading.value || employees.isLoading.value"
      :error="initialDataReady ? undefined : dependencyError"
      @retry="retryDependencies"
    >
      <EmployeeGeneralForm :departments="departments.data.value?.items ?? []" :employees="employees.data.value?.items ?? []" :back-to="backTo" @saved="created" />
    </SharedPageState>
    <SharedPageState v-if="canManage && initialDataReady && dependencyError" :error="dependencyError" @retry="retryDependencies" />
  </SharedCreatePanel>
</template>
