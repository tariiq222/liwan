<script setup lang="ts">
import DirectoryTable from '@/components/hr/DirectoryTable.vue'
import DepartmentTable from '@/components/hr/DepartmentTable.vue'
import { useHrDepartments } from '@/composables/useHrDepartments'
import { returnToQuery } from '@/utils/safeReturnTo'

const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const route = useRoute()
const tab = ref<'employees' | 'departments'>('employees')
const initialDepartmentId = typeof route.query.department_id === 'string' ? Number(route.query.department_id) : NaN
const selectedDepartmentId = ref<number | null>(Number.isSafeInteger(initialDepartmentId) && initialDepartmentId > 0 ? initialDepartmentId : null)
const { data: departmentData } = useHrDepartments()
const departments = computed(() => departmentData.value?.items ?? [])
function openEmployee(id: number) { void navigateTo({ path: `/hr/employees/${id}`, query: returnToQuery(route.fullPath) }) }
function editEmployee(id: number) { void navigateTo({ path: `/hr/employees/${id}/edit`, query: returnToQuery(route.fullPath) }) }
</script>

<template>
  <SharedPageContainer width="list">
    <SharedPageHeader :title="t('hr.directory.title')" :description="t('hr.directory.description')">
      <NuxtLink v-if="can('hr.employees.manage')" :to="{ path: '/hr/employees/new', query: returnToQuery(route.fullPath) }"><Button :disabled="!hydrated">
        {{ t('hr.directory.newEmployee') }}
      </Button></NuxtLink>
    </SharedPageHeader>
    <Tabs v-model="tab" class="space-y-4">
      <TabsList>
        <TabsTrigger value="employees" :disabled="!hydrated">{{ t('hr.tabs.employees') }}</TabsTrigger>
        <TabsTrigger v-if="can('hr.departments.read')" value="departments" :disabled="!hydrated">{{ t('hr.tabs.departments') }}</TabsTrigger>
      </TabsList>
      <TabsContent value="employees"><DirectoryTable v-model:department-id="selectedDepartmentId" @open="openEmployee" @manage="editEmployee" @archive="openEmployee" /></TabsContent>
      <TabsContent v-if="can('hr.departments.read')" value="departments" class="space-y-4">
        <DepartmentTable :departments="departments" :selected-id="selectedDepartmentId" :can-manage="can('hr.departments.manage')" @select="selectedDepartmentId = $event" />
        <NuxtLink v-if="selectedDepartmentId && can('hr.documents.read')" :to="{ path: `/hr/departments/${selectedDepartmentId}`, query: returnToQuery(route.fullPath) }" class="text-sm underline">{{ t('hr.depts.selectHelp') }}</NuxtLink>
      </TabsContent>
    </Tabs>
  </SharedPageContainer>
</template>
