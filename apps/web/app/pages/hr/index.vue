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
      <Button v-if="can('hr.employees.manage')" as-child :disabled="!hydrated"><NuxtLink :to="{ path: '/hr/employees/new', query: returnToQuery(route.fullPath) }" @click="!hydrated && $event.preventDefault()">
        {{ t('hr.directory.newEmployee') }}
      </NuxtLink></Button>
    </SharedPageHeader>
    <DirectoryTable v-model:department-id="selectedDepartmentId" @open="openEmployee" @manage="editEmployee" @archive="openEmployee" />
  </SharedPageContainer>
</template>
