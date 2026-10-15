<script setup lang="ts">
import { hrDepartmentBack, hrDepartmentContext } from '@/utils/hrReturnTo'
import DocumentList from '@/components/hr/DocumentList.vue'
import { useHrDepartment } from '@/composables/useHrDepartments'
const route = useRoute()
const sourcePaths = useRecordListPaths(['/hr/departments', '/hr/documents']); const { t } = useI18n(); const { can } = useAccess(); const hydrated = useHydrated()
const id = computed(() => Number(route.params.departmentId))
const validId = computed(() => Number.isSafeInteger(id.value) && id.value > 0)
const isCreateDocument = computed(() => route.path === `/hr/departments/${route.params.departmentId}/documents/new`)
const isDetail = computed(() => route.path === `/hr/departments/${route.params.departmentId}` || isCreateDocument.value)
const query = useHrDepartment(computed(() => isDetail.value && validId.value ? id.value : null))
const department = computed(() => query.data.value)
const pageError = computed(() => query.error.value ?? (validId.value ? null : new ApiError(404, 'not_found', t('errors.generic'))))
const backTo = computed(() => hrDepartmentBack(route.query, route.hash, sourcePaths.value))
const editTo = computed(() => ({ path: `/hr/departments/${id.value}/edit`, query: hrDepartmentContext(route.query, sourcePaths.value), ...(route.hash ? { hash: route.hash } : {}) }))
</script>
<template>
  <!-- Under the create-document panel the registered (shell) title stays static and no heading is drawn,
       so the panel's own <h1> is the only one and the loaded department name never overwrites its title. -->
  <SharedRecordPage :keep-content="!!department"
    v-if="isDetail"
    :title="isCreateDocument ? t('hr.depts.title') : (department?.name || t('hr.depts.title'))"
    :hide-header="isCreateDocument"
    :back-to="isCreateDocument ? undefined : backTo"
    :loading="query.isLoading.value"
    :error="pageError"
    @retry="query.refetch"
  >
    <template v-if="department && can('hr.departments.manage')" #actions>
      <UButton color="primary" :disabled="!hydrated" :to="editTo" :label="t('hr.depts.edit')" @click="!hydrated && $event.preventDefault()" />
    </template>
    <SharedRecordSection v-if="department && can('hr.documents.read')" :title="t('hr.depts.detail')">
      <DocumentList :department-id="id" :can-write="can('hr.documents.manage')" />
    </SharedRecordSection>
    <template v-if="department" #summary>
      <SharedPropertiesPanel :title="t('hr.card.overview')">
        <SharedPropertyRow :label="t('hr.tabs.employees')" :value="department.employee_count" />
        <SharedPropertyRow :label="t('hr.depts.manager')" :value="department.manager?.name || t('hr.depts.noManager')" />
      </SharedPropertiesPanel>
    </template>
  </SharedRecordPage>
  <NuxtPage />
</template>
