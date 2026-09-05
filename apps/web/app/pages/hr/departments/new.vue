<script setup lang="ts">
import DepartmentForm from '@/components/hr/DepartmentForm.vue'
import { useHrDepartments } from '@/composables/useHrDepartments'
import { useHrEmployees } from '@/composables/useHrEmployees'
import { safeReturnTo, returnToQuery } from '@/utils/safeReturnTo'
const route = useRoute(); const { t } = useI18n(); const { data: departments } = useHrDepartments(); const { data: employees } = useHrEmployees({})
const returnTo = computed(() => safeReturnTo(route.query.returnTo, '/hr/departments', ['/hr']))
function saved(department: { id: number }) { void navigateTo({ path: `/hr/departments/${department.id}`, query: returnToQuery(returnTo.value) }) }
</script>
<template><div class="space-y-6"><SharedPageHeader :title="t('hr.depts.new')" :back-to="returnTo" /><DepartmentForm :departments="departments?.items ?? []" :employees="employees?.items ?? []" :back-to="returnTo" @saved="saved" /></div></template>
