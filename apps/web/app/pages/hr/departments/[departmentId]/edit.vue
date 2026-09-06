<script setup lang="ts">
import DepartmentForm from '@/components/hr/DepartmentForm.vue'
import { useHrDepartment, useHrDepartments } from '@/composables/useHrDepartments'
import { useHrEmployees } from '@/composables/useHrEmployees'
import { safeReturnTo, returnToQuery } from '@/utils/safeReturnTo'
const route = useRoute(); const { t } = useI18n(); const { data: departments } = useHrDepartments(); const { data: employees } = useHrEmployees({}); const id = computed(() => Number(route.params.departmentId)); const query = useHrDepartment(id); const department = computed(() => query.data.value)
const fallback = computed(() => `/hr/departments/${id.value}`)
const returnTo = computed(() => safeReturnTo(route.query.returnTo, fallback.value, ['/hr']))
function saved() { void navigateTo({ path: fallback.value, query: returnToQuery(returnTo.value) }) }
</script>
<template><div class="mx-auto w-full max-w-4xl space-y-8"><SharedPageHeader :title="t('hr.depts.edit')" :back-to="returnTo" /><SharedPageState :loading="query.isLoading.value" :error="query.error.value" :empty="!department" @retry="query.refetch" /><section v-if="department" class="rounded-lg border border-border/80 bg-card p-4 sm:p-6"><DepartmentForm :department="department" :departments="departments?.items ?? []" :employees="employees?.items ?? []" :back-to="returnTo" @saved="saved" /></section></div></template>
