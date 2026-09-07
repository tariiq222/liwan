<script setup lang="ts">
import EmployeeGeneralForm from '@/components/hr/EmployeeGeneralForm.vue'
import { useHrDepartments } from '@/composables/useHrDepartments'
import { useHrEmployees } from '@/composables/useHrEmployees'
import { returnToQuery, safeReturnTo } from '@/utils/safeReturnTo'
const route = useRoute()
const { t } = useI18n()
const returnTo = computed(() => safeReturnTo(route.query.returnTo, '/hr', ['/hr']))
const { data: departments } = useHrDepartments()
const { data: employees } = useHrEmployees({})
function created(employee: { id: number }) { void navigateTo({ path: `/hr/employees/${employee.id}`, query: returnToQuery(returnTo.value) }) }
</script>
<template>
  <SharedPageContainer width="form"><SharedPageHeader :title="t('hr.employee.createTitle')" :back-to="returnTo" /><section class="nasq-panel nasq-panel-body"><EmployeeGeneralForm :departments="departments?.items ?? []" :employees="employees?.items ?? []" @saved="created"><template #actions><NuxtLink :to="returnTo"><Button type="button" variant="outline">{{ t('app.cancel') }}</Button></NuxtLink></template></EmployeeGeneralForm></section></SharedPageContainer>
</template>
