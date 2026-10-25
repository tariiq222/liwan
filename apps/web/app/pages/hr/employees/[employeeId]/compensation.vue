<script setup lang="ts">
import { recordParentTo } from '@/utils/recordListOrigin'
import { EMPLOYEE_LIST_PATHS } from '@/modules/hr/navigation'
import CompensationForm from '@/components/hr/payroll/CompensationForm.vue'
import { useHrEmployee } from '@/composables/useHrEmployees'
import { useHrCompensation } from '@/composables/useHrPayrollCompensation'
const route = useRoute()
const sourcePaths = useRecordListPaths(EMPLOYEE_LIST_PATHS); const { t } = useI18n(); const { can } = useAccess()
const id = computed(() => Number(route.params.employeeId))
const employee = useHrEmployee(id)
const compensation = useHrCompensation(id)
const canManage = computed(() => can('hr.payroll.manage'))
const backTo = computed(() => recordParentTo(`/hr/employees/${id.value}`, route.query, sourcePaths.value, route.hash))
const loading = computed(() => employee.isLoading.value || compensation.isLoading.value)
const error = computed(() => employee.error.value ?? compensation.error.value)
function retry() { void employee.refetch(); void compensation.refetch() }
function saved() { void navigateTo(backTo.value) }
</script>
<template>
  <SharedPageContainer width="form">
    <SharedPageHeader :title="t('hrPayroll.compensation.editTitle')" :back-to="backTo" />
    <SharedForbiddenState v-if="!canManage" :description="t('hrPayroll.compensation.forbidden')" />
    <SharedPageState v-else :loading="loading" :error="error" :empty="!employee.data.value || compensation.data.value === undefined" @retry="retry">
      <CompensationForm :employee-id="id" :compensation="compensation.data.value ?? null" :back-to="backTo" @saved="saved" />
    </SharedPageState>
  </SharedPageContainer>
</template>
