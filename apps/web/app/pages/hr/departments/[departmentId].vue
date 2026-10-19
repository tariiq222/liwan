<script setup lang="ts">
import { hrDepartmentBack, hrDepartmentContext } from '@/utils/hrReturnTo'
import { useHrDepartment } from '@/composables/useHrDepartments'
const route = useRoute()
const sourcePaths = useRecordListPaths(['/hr/departments']); const { t } = useI18n(); const { can } = useAccess(); const hydrated = useHydrated()
const id = computed(() => Number(route.params.departmentId))
const validId = computed(() => Number.isSafeInteger(id.value) && id.value > 0)
const isDetail = computed(() => route.path === `/hr/departments/${route.params.departmentId}`)
const query = useHrDepartment(computed(() => isDetail.value && validId.value ? id.value : null))
const department = computed(() => query.data.value)
const pageError = computed(() => query.error.value ?? (validId.value ? null : new ApiError(404, 'not_found', t('errors.generic'))))
const backTo = computed(() => hrDepartmentBack(route.query, route.hash, sourcePaths.value))
const editTo = computed(() => ({ path: `/hr/departments/${id.value}/edit`, query: hrDepartmentContext(route.query, sourcePaths.value), ...(route.hash ? { hash: route.hash } : {}) }))
</script>
<template>
  <SharedRecordPage :keep-content="!!department"
    v-if="isDetail"
    :title="department?.name || t('hr.depts.title')"
    :back-to="backTo"
    :loading="query.isLoading.value"
    :error="pageError"
    @retry="query.refetch"
  >
    <template v-if="department && can('hr.departments.manage')" #actions>
      <UButton color="primary" :disabled="!hydrated" :to="editTo" :label="t('hr.depts.edit')" @click="!hydrated && $event.preventDefault()" />
    </template>
    <SharedIdentityCard v-if="department" :id="department.id" :name="department.name" :subtitle="department.manager?.name || t('hr.depts.noManager')">
      <template #badge>
        <SharedStatusBadge size="sm" tone="neutral" :label="t('hr.depts.employeeReason', { count: department.employee_count }, department.employee_count)" />
      </template>
    </SharedIdentityCard>
    <SharedRecordSection v-if="department && can('documents.items.read')" :title="t('hr.depts.viewDocuments')">
      <UButton color="neutral" variant="outline" icon="i-lucide-files" :disabled="!hydrated" :to="{ path: '/documents', query: { context_kind: 'hr.department', context_id: String(id) } }" :label="t('hr.depts.viewDocuments')" />
    </SharedRecordSection>
    <template v-if="department" #aside>
      <SharedPropertiesPanel>
        <SharedPropertyRow :label="t('hr.tabs.employees')" :value="department.employee_count" />
        <SharedPropertyRow :label="t('hr.depts.manager')" :value="department.manager?.name || t('hr.depts.noManager')" />
        <SharedPropertyRow :label="t('hr.depts.children')" :value="department.child_ids.length" />
      </SharedPropertiesPanel>
    </template>
  </SharedRecordPage>
  <NuxtPage />
</template>
