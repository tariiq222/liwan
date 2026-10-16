<script setup lang="ts">
import DirectoryTable from '@/components/hr/DirectoryTable.vue'
import { returnToQuery } from '@webvue/ui/app/utils/safeReturnTo'

const { t } = useI18n()
const { can } = useAccess()
const route = useRoute()
const initialDepartmentId = typeof route.query.department_id === 'string' ? Number(route.query.department_id) : NaN
const selectedDepartmentId = ref<number | null>(Number.isSafeInteger(initialDepartmentId) && initialDepartmentId > 0 ? initialDepartmentId : null)
// The create panel's own back trip is literal (employees/new.vue drops a referrer's returnTo and keeps
// only the list state), so the link carries the list state and nothing else.
const createTo = computed(() => {
  if (!can('hr.employees.manage')) return undefined
  const { returnTo: _referrer, ...listQuery } = route.query
  return { path: '/hr/employees/new', query: listQuery }
})
function editEmployee(id: number) { void navigateTo({ path: `/hr/employees/${id}/edit`, query: returnToQuery(route.fullPath) }) }
</script>

<template>
  <SharedListPage
    :title="t('nav.employees')"
    :create-to="createTo"
    :create-label="t('hr.directory.newEmployee')"
    create-test-id="hr-employee-new"
  >
    <DirectoryTable v-model:department-id="selectedDepartmentId" @manage="editEmployee" />
  </SharedListPage>
</template>
