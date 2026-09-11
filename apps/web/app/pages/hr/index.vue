<script setup lang="ts">
import DirectoryTable from '@/components/hr/DirectoryTable.vue'
import { returnToQuery } from '@/utils/safeReturnTo'

const { t } = useI18n()
const route = useRoute()
const initialDepartmentId = typeof route.query.department_id === 'string' ? Number(route.query.department_id) : NaN
const selectedDepartmentId = ref<number | null>(Number.isSafeInteger(initialDepartmentId) && initialDepartmentId > 0 ? initialDepartmentId : null)
function openEmployee(id: number) { void navigateTo({ path: `/hr/employees/${id}`, query: returnToQuery(route.fullPath) }) }
function editEmployee(id: number) { void navigateTo({ path: `/hr/employees/${id}/edit`, query: returnToQuery(route.fullPath) }) }
</script>

<template>
  <SharedPageContainer width="list">
    <SharedPageHeader :title="t('nav.employees')" />
    <DirectoryTable v-model:department-id="selectedDepartmentId" @open="openEmployee" @manage="editEmployee" />
  </SharedPageContainer>
</template>
