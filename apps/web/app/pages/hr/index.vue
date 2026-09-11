<script setup lang="ts">
import DirectoryTable from '@/components/hr/DirectoryTable.vue'
import { returnToQuery } from '@/utils/safeReturnTo'

const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const route = useRoute()
const initialDepartmentId = typeof route.query.department_id === 'string' ? Number(route.query.department_id) : NaN
const selectedDepartmentId = ref<number | null>(Number.isSafeInteger(initialDepartmentId) && initialDepartmentId > 0 ? initialDepartmentId : null)
function openEmployee(id: number) { void navigateTo({ path: `/hr/employees/${id}`, query: returnToQuery(route.fullPath) }) }
function editEmployee(id: number) { void navigateTo({ path: `/hr/employees/${id}/edit`, query: returnToQuery(route.fullPath) }) }
</script>

<template>
  <SharedPageContainer width="list">
    <SharedPageHeader :title="t('hr.directory.title')">
      <UButton v-if="can('hr.employees.manage')" color="primary" :disabled="!hydrated" :to="{ path: '/hr/employees/new', query: returnToQuery(route.fullPath) }" :label="t('hr.directory.newEmployee')" @click="!hydrated && $event.preventDefault()" />
    </SharedPageHeader>
    <DirectoryTable v-model:department-id="selectedDepartmentId" @open="openEmployee" @manage="editEmployee" @archive="openEmployee" />
  </SharedPageContainer>
</template>
