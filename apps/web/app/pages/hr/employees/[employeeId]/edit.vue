<script setup lang="ts">
import EmployeeGeneralForm from '@/components/hr/EmployeeGeneralForm.vue'
import { useHrDepartments } from '@/composables/useHrDepartments'
import { useHrEmployee, useHrEmployees } from '@/composables/useHrEmployees'
import { returnToQuery, safeReturnTo } from '@/utils/safeReturnTo'
const route = useRoute(); const { t } = useI18n(); const id = computed(() => Number(route.params.employeeId)); const query = useHrEmployee(id)
const returnTo = computed(() => safeReturnTo(route.query.returnTo, `/hr/employees/${id.value}`, ['/hr']))
const { data: departments } = useHrDepartments(); const { data: employees } = useHrEmployees({})
function saved() { void navigateTo({ path: `/hr/employees/${id.value}`, query: returnToQuery(returnTo.value) }) }
</script>
<template>
  <SharedPageContainer width="form"><SharedPageHeader :title="t('hr.employee.editTitle')" :back-to="returnTo" /><SharedPageState :loading="query.isLoading.value" :error="query.error.value" :empty="!query.data.value" @retry="query.refetch" /><div v-if="query.data.value" class="nasq-panel nasq-panel-body"><EmployeeGeneralForm :employee="query.data.value" :departments="departments?.items ?? []" :employees="employees?.items ?? []" @saved="saved"><template #actions><NuxtLink :to="returnTo"><Button type="button" variant="outline">{{ t('app.cancel') }}</Button></NuxtLink></template></EmployeeGeneralForm></div></SharedPageContainer>
</template>
