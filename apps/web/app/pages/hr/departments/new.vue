<script setup lang="ts">
import DepartmentForm from '@/components/hr/DepartmentForm.vue'
import { useHrDepartments } from '@/composables/useHrDepartments'
import { useHrEmployees } from '@/composables/useHrEmployees'
import { safeReturnTo, returnToQuery } from '@/utils/safeReturnTo'
const route = useRoute(); const { t } = useI18n(); const { data: departments } = useHrDepartments(); const { data: employees } = useHrEmployees({})
const initialParentId = computed(() => { const raw = route.query.parent_id; const id = typeof raw === 'string' ? Number(raw) : 0; return Number.isSafeInteger(id) && id > 0 ? id : null })
const returnTo = computed(() => safeReturnTo(route.query.returnTo, '/hr/departments', ['/hr']))
function saved(department: { id: number }) { void navigateTo({ path: `/hr/departments/${department.id}`, query: returnToQuery(returnTo.value) }) }
</script>
<template><div class="mx-auto w-full max-w-4xl space-y-8"><SharedPageHeader :title="t('hr.depts.new')" :back-to="returnTo" /><section class="rounded-lg border border-border/80 bg-card p-4 sm:p-6"><DepartmentForm :initial-parent-id="initialParentId" :departments="departments?.items ?? []" :employees="employees?.items ?? []" :back-to="returnTo" @saved="saved" /></section></div></template>
