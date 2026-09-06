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
  <div class="mx-auto w-full max-w-4xl space-y-8"><SharedPageHeader :title="t('hr.employee.createTitle')" :back-to="returnTo" /><section class="rounded-lg border border-border/80 bg-card p-4 sm:p-6"><EmployeeGeneralForm :departments="departments?.items ?? []" :employees="employees?.items ?? []" @saved="created" /></section></div>
</template>
