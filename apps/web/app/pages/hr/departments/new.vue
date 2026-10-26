<script setup lang="ts">
import { owningListBack } from '@/utils/recordListOrigin'
import DepartmentForm from '@/components/hr/DepartmentForm.vue'
import { useHrDepartments } from '@/composables/useHrDepartments'
import { useHrEmployees } from '@/composables/useHrEmployees'
const route = useRoute()
const router = useRouter(); const { t } = useI18n(); const { can } = useAccess(); const departments = useHrDepartments(); const employees = useHrEmployees({})
const canManage = computed(() => can('hr.departments.manage'))
const initialDataReady = computed(() => Boolean(departments.data.value && employees.data.value))
const dependencyError = computed(() => departments.error.value || employees.error.value)
function retryDependencies() { void departments.refetch(); void employees.refetch() }
const initialParentId = computed(() => { const raw = route.query.parent_id; const id = typeof raw === 'string' ? Number(raw) : 0; return Number.isSafeInteger(id) && id > 0 ? id : null })
const sourcePaths = useRecordListPaths(['/hr/departments'])
const backTo = computed(() => owningListBack(route.query, sourcePaths.value, route.hash))
function saved(department: { id: number }) { void navigateTo({ path: `/hr/departments/${department.id}`, query: { returnTo: router.resolve(backTo.value).fullPath } }, { replace: true }) }
</script>
<template>
  <SharedCreatePanel :title="t('hr.depts.new')" :back-to="backTo">
    <SharedForbiddenState v-if="!canManage" />
    <SharedPageState v-else :loading="departments.isLoading.value || employees.isLoading.value" :error="initialDataReady ? undefined : dependencyError" @retry="retryDependencies">
      <DepartmentForm :initial-parent-id="initialParentId" :departments="departments.data.value?.items ?? []" :employees="employees.data.value?.items ?? []" :back-to="backTo" @saved="saved" />
    </SharedPageState>
    <SharedPageState v-if="canManage && initialDataReady && dependencyError" :error="dependencyError" @retry="retryDependencies" />
  </SharedCreatePanel>
</template>
