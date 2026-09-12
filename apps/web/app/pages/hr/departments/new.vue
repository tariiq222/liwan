<script setup lang="ts">
import DepartmentForm from '@/components/hr/DepartmentForm.vue'
import { useHrDepartments } from '@/composables/useHrDepartments'
import { useHrEmployees } from '@/composables/useHrEmployees'
import { safeReturnTo, returnToQuery } from '@/utils/safeReturnTo'
const route = useRoute(); const { t } = useI18n(); const { can } = useAccess(); const departments = useHrDepartments(); const employees = useHrEmployees({})
const canManage = computed(() => can('hr.departments.manage'))
const initialDataReady = computed(() => Boolean(departments.data.value && employees.data.value))
const dependencyError = computed(() => departments.error.value || employees.error.value)
function retryDependencies() { void departments.refetch(); void employees.refetch() }
const initialParentId = computed(() => { const raw = route.query.parent_id; const id = typeof raw === 'string' ? Number(raw) : 0; return Number.isSafeInteger(id) && id > 0 ? id : null })
const returnTo = computed(() => safeReturnTo(route.query.returnTo, '/hr/departments', ['/hr']))
function saved(department: { id: number }) { void navigateTo({ path: `/hr/departments/${department.id}`, query: returnToQuery(returnTo.value) }) }
</script>
<template>
  <SharedPageContainer width="form">
    <SharedPageHeader :title="t('hr.depts.new')" :back-to="returnTo" />
    <SharedPageState v-if="!canManage" :empty="true" :empty-text="t('errors.forbidden')" />
    <SharedPageState v-else :loading="departments.isLoading.value || employees.isLoading.value" :error="initialDataReady ? undefined : dependencyError" @retry="retryDependencies">
      <UCard class="nasq-ui-record-surface" :ui="{ body: 'p-5 sm:p-6' }"><DepartmentForm :initial-parent-id="initialParentId" :departments="departments.data.value?.items ?? []" :employees="employees.data.value?.items ?? []" :back-to="returnTo" @saved="saved" /></UCard>
    </SharedPageState>
    <SharedPageState v-if="canManage && initialDataReady && dependencyError" :error="dependencyError" @retry="retryDependencies" />
  </SharedPageContainer>
</template>
